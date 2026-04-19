"use client";

import { db } from "./firebase";
import { doc, setDoc, getDoc, deleteDoc } from "firebase/firestore";
import { useEffect, useState } from "react";

const STORAGE_KEY = "imposter_webapp_v1";
const ADMIN_KEY = "1907";
function uid(len = 8) {
    const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
    let out = "";
    for (let i = 0; i < len; i++) {
        out += chars[Math.floor(Math.random() * chars.length)];
    }
    return out;
}

function getBaseUrl() {
    if (typeof window === "undefined") return "";
    return `${window.location.origin}${window.location.pathname}`;
}

function buildHostLink() {
    return `${getBaseUrl()}?view=host`;
}

function buildPlayerLink(playerId) {
    return `${getBaseUrl()}?view=player&id=${playerId}`;
}

function loadState() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

function defaultState() {
    return {
        players: [],
        lastSelectedPlayerIds: [],
    };
}

export default function Page() {
    const [mounted, setMounted] = useState(false);
    const [view, setView] = useState("home");
    const [playerId, setPlayerId] = useState("");

    const [appState, setAppState] = useState(defaultState());
    const [newPlayerName, setNewPlayerName] = useState("");
    const [hostPlayerIds, setHostPlayerIds] = useState([]);
    const [hostImposterIds, setHostImposterIds] = useState([]);
    const [place, setPlace] = useState("");
    const [showReusePrompt, setShowReusePrompt] = useState(false);
    const [remoteGame, setRemoteGame] = useState(null);
    const [hostLocked, setHostLocked] = useState(false);
    const [isAdmin, setIsAdmin] = useState(false);
    useEffect(() => {
        setMounted(true);

        const params = new URLSearchParams(window.location.search);
        setView(params.get("view") || "home");
        setPlayerId(params.get("id") || "");
        const isAdminParam = params.get("admin") === ADMIN_KEY;
        setIsAdmin(isAdminParam);
        useEffect(() => {
            async function lockHostIfNeeded() {
                if (!mounted) return;
                if (view !== "host") return;
                if (isAdmin) return;

                await claimHostLock();
            }

            lockHostIfNeeded();
        }, [mounted, view, isAdmin]);
        const saved = loadState();
        if (saved) {
            setAppState(saved);
            setHostPlayerIds(saved.lastSelectedPlayerIds || []);
        }
    }, []);

    useEffect(() => {
        if (!mounted) return;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(appState));
    }, [appState, mounted]);

    useEffect(() => {
        async function loadGame() {
            try {
                const docRef = doc(db, "game", "current");
                const docSnap = await getDoc(docRef);

                if (docSnap.exists()) {
                    setRemoteGame(docSnap.data());
                } else {
                    setRemoteGame(null);
                }
            } catch (error) {
                console.error("Error loading game:", error);
            }
        }

        if (!mounted) return;

        loadGame();
        const interval = setInterval(loadGame, 2000);
        return () => clearInterval(interval);
    }, [mounted]);

    useEffect(() => {
        async function loadHostLock() {
            try {
                const docRef = doc(db, "host", "lock");
                const docSnap = await getDoc(docRef);

                if (docSnap.exists()) {
                    const data = docSnap.data();
                    setHostLocked(!!data.locked);
                } else {
                    setHostLocked(false);
                }
            } catch (error) {
                console.error("Error loading host lock:", error);
            }
        }

        if (!mounted) return;

        loadHostLock();
        const interval = setInterval(loadHostLock, 2000);
        return () => clearInterval(interval);
    }, [mounted]);



    useEffect(() => {
        async function loadPlayers() {
            try {
                const docRef = doc(db, "shared", "players");
                const docSnap = await getDoc(docRef);

                if (docSnap.exists()) {
                    const data = docSnap.data();
                    setAppState((prev) => ({
                        ...prev,
                        players: data.players || [],
                    }));
                }
            } catch (error) {
                console.error("Error loading players:", error);
            }
        }

        if (!mounted) return;

        loadPlayers();
        const interval = setInterval(loadPlayers, 2000);
        return () => clearInterval(interval);
    }, [mounted]);


    useEffect(() => {
        if (
            mounted &&
            view === "host" &&
            appState.lastSelectedPlayerIds.length > 0 &&
            hostPlayerIds.length === 0 &&
            !remoteGame?.active
        ) {
            setShowReusePrompt(true);
        }
    }, [
        mounted,
        view,
        appState.lastSelectedPlayerIds,
        hostPlayerIds.length,
        remoteGame?.active,
    ]);

    function copyText(text) {
        navigator.clipboard.writeText(text).catch(() => { });
    }

    async function addPlayer() {
        const name = newPlayerName.trim();
        if (!name) return;

        const player = {
            id: uid(10),
            name,
        };

        const nextPlayers = [...appState.players, player];

        setAppState((prev) => ({
            ...prev,
            players: nextPlayers,
        }));

        await setDoc(doc(db, "shared", "players"), {
            players: nextPlayers,
        });

        setNewPlayerName("");
    }

    async function claimHostLock() {
        try {
            const lockRef = doc(db, "host", "lock");
            const lockSnap = await getDoc(lockRef);

            if (!lockSnap.exists()) {
                await setDoc(lockRef, { locked: true });
                setHostLocked(true);
                return true;
            }

            const lockData = lockSnap.data();
            if (!lockData.locked) {
                await setDoc(lockRef, { locked: true });
                setHostLocked(true);
                return true;
            }

            return false;
        } catch (error) {
            console.error("Error claiming host lock:", error);
            return false;
        }
    }


    async function removePlayer(id) {
        const nextPlayers = appState.players.filter((p) => p.id !== id);

        setAppState((prev) => ({
            ...prev,
            players: nextPlayers,
            lastSelectedPlayerIds: prev.lastSelectedPlayerIds.filter((x) => x !== id),
        }));

        setHostPlayerIds((prev) => prev.filter((x) => x !== id));
        setHostImposterIds((prev) => prev.filter((x) => x !== id));

        await setDoc(doc(db, "shared", "players"), {
            players: nextPlayers,
        });
    }
    async function startGame() {
        if (
            !place.trim() ||
            hostPlayerIds.length === 0 ||
            hostImposterIds.length === 0 ||
            hostImposterIds.length >= hostPlayerIds.length
        ) {
            return;
        }

        const gameData = {
            place: place.trim(),
            selectedPlayerIds: hostPlayerIds,
            imposterIds: hostImposterIds,
            active: true,
        };

        try {
            await setDoc(doc(db, "game", "current"), gameData);

            setAppState((prev) => ({
                ...prev,
                lastSelectedPlayerIds: hostPlayerIds,
            }));

            setRemoteGame(gameData);
        } catch (error) {
            console.error("Error starting game:", error);
        }
    }

    async function endGame() {
        const endedGame = {
            place: "",
            selectedPlayerIds: [],
            imposterIds: [],
            active: false,
        };

        try {
            await setDoc(doc(db, "game", "current"), endedGame);
            await deleteDoc(doc(db, "host", "lock"));

            setRemoteGame(endedGame);
            setHostLocked(false);
            setPlace("");
            setHostImposterIds([]);
        } catch (error) {
            console.error("Error ending game:", error);
        }
    }
    function useSamePlayers() {
        setHostPlayerIds(appState.lastSelectedPlayerIds);
        setHostImposterIds([]);
        setShowReusePrompt(false);
    }

    function changePlayers() {
        setHostPlayerIds([]);
        setHostImposterIds([]);
        setShowReusePrompt(false);
    }

    const selectedPlayers = appState.players.filter((p) =>
        hostPlayerIds.includes(p.id)
    );

    const lastPlayers = appState.players.filter((p) =>
        appState.lastSelectedPlayerIds.includes(p.id)
    );

    const currentPlayer = appState.players.find((p) => p.id === playerId);

    const startDisabled =
        !place.trim() ||
        hostPlayerIds.length === 0 ||
        hostImposterIds.length === 0 ||
        hostImposterIds.length >= hostPlayerIds.length;

    if (!mounted) {
        return null;
    }

    if (view === "host" && hostLocked && !isAdmin) {
        return (
            <main style={styles.page}>
                <div style={styles.containerSmall}>
                    <div style={styles.card}>
                        <h2>Host is locked</h2>
                    </div>
                </div>
            </main>
        );
    }



    if (view === "host") {
        return (
            <main style={styles.page}>
                <div style={styles.container}>
                    <div style={styles.card}>
                        <h1>Leader View</h1>

                        {showReusePrompt && lastPlayers.length > 0 && !remoteGame?.active && (
                            <div style={styles.box}>
                                <p>
                                    <strong>Use same players as last game?</strong>
                                </p>
                                <p>{lastPlayers.map((p) => p.name).join(", ")}</p>
                                <div style={styles.row}>
                                    <button style={styles.button} onClick={useSamePlayers}>
                                        Use same players
                                    </button>
                                    <button style={styles.buttonOutline} onClick={changePlayers}>
                                        Change players
                                    </button>
                                </div>
                            </div>
                        )}

                        <div style={styles.section}>
                            <h3>Choose Players</h3>
                            {appState.players.length === 0 ? (
                                <p>No players added yet.</p>
                            ) : (
                                appState.players.map((player) => (
                                    <label key={player.id} style={styles.checkboxRow}>
                                        <input
                                            type="checkbox"
                                            checked={hostPlayerIds.includes(player.id)}
                                            onChange={() => {
                                                const isSelected = hostPlayerIds.includes(player.id);
                                                if (isSelected) {
                                                    setHostPlayerIds((prev) =>
                                                        prev.filter((x) => x !== player.id)
                                                    );
                                                    setHostImposterIds((prev) =>
                                                        prev.filter((x) => x !== player.id)
                                                    );
                                                } else {
                                                    setHostPlayerIds((prev) => [...prev, player.id]);
                                                }
                                            }}
                                        />
                                        <span>{player.name}</span>
                                    </label>
                                ))
                            )}
                        </div>

                        <div style={styles.section}>
                            <h3>Place</h3>
                            <input
                                style={styles.input}
                                placeholder="e.g. Restaurant"
                                value={place}
                                onChange={(e) => setPlace(e.target.value)}
                            />
                        </div>

                        <div style={styles.section}>
                            <h3>Choose Imposters</h3>
                            {selectedPlayers.length === 0 ? (
                                <p>Select players first.</p>
                            ) : (
                                selectedPlayers.map((player) => (
                                    <label key={player.id} style={styles.checkboxRow}>
                                        <input
                                            type="checkbox"
                                            checked={hostImposterIds.includes(player.id)}
                                            onChange={() => {
                                                if (hostImposterIds.includes(player.id)) {
                                                    setHostImposterIds((prev) =>
                                                        prev.filter((x) => x !== player.id)
                                                    );
                                                } else {
                                                    setHostImposterIds((prev) => [...prev, player.id]);
                                                }
                                            }}
                                        />
                                        <span>{player.name}</span>
                                    </label>
                                ))
                            )}
                        </div>

                        <div style={styles.box}>
                            <p>
                                Selected players: <strong>{hostPlayerIds.length}</strong>
                            </p>
                            <p>
                                Imposters: <strong>{hostImposterIds.length}</strong>
                            </p>
                            <p style={{ color: "#666" }}>
                                لازم يبقى فيه مكان + لاعب واحد على الأقل + imposter واحد على الأقل +
                                على الأقل لاعب عادي واحد.
                            </p>
                        </div>

                        <div style={styles.row}>
                            <button
                                style={startDisabled ? styles.buttonDisabled : styles.button}
                                onClick={startGame}
                                disabled={startDisabled}
                            >
                                Start Game
                            </button>
                            <button style={styles.buttonOutline} onClick={endGame}>
                                End Game
                            </button>
                        </div>

                        <div style={styles.box}>
                            <p>
                                Game status:{" "}
                                <strong>{remoteGame?.active ? "Active" : "No active game"}</strong>
                            </p>

                            {remoteGame?.active && (
                                <>
                                    <p>
                                        Place: <strong>{remoteGame?.place}</strong>
                                    </p>
                                    <p>
                                        Players:{" "}
                                        {appState.players
                                            .filter((p) => remoteGame?.selectedPlayerIds?.includes(p.id))
                                            .map((p) => p.name)
                                            .join(", ")}
                                    </p>
                                    <p>
                                        Imposters:{" "}
                                        {appState.players
                                            .filter((p) => remoteGame?.imposterIds?.includes(p.id))
                                            .map((p) => p.name)
                                            .join(", ")}
                                    </p>
                                </>
                            )}
                        </div>
                    </div>
                </div>
            </main>
        );
    }

    if (view === "player") {
        return (
            <main style={styles.page}>
                <div style={styles.containerSmall}>
                    <div style={styles.card}>
                        <h1>Player View</h1>

                        {!currentPlayer && <p>Invalid player link</p>}

                        {currentPlayer && (
                            <>
                                <h2>{currentPlayer.name}</h2>

                                {!remoteGame?.active && (
                                    <div style={styles.roleBox}>No active game</div>
                                )}

                                {remoteGame?.active &&
                                    !remoteGame?.selectedPlayerIds?.includes(currentPlayer.id) && (
                                        <div style={styles.roleBox}>You are not in this round</div>
                                    )}

                                {remoteGame?.active &&
                                    remoteGame?.selectedPlayerIds?.includes(currentPlayer.id) && (
                                        <div style={styles.roleBox}>
                                            {remoteGame?.imposterIds?.includes(currentPlayer.id) ? (
                                                <>
                                                    <div style={styles.smallLabel}>Your Role</div>
                                                    <div style={styles.bigText}>Imposter</div>
                                                </>
                                            ) : (
                                                <>
                                                    <div style={styles.smallLabel}>Place</div>
                                                    <div style={styles.bigText}>{remoteGame?.place}</div>
                                                </>
                                            )}
                                        </div>
                                    )}
                            </>
                        )}
                    </div>
                </div>
            </main>
        );
    }

    return (
        <main style={styles.page}>
            <div style={styles.container}>
                <div style={styles.card}>
                    <h1>Setup Players</h1>

                    <div style={styles.row}>
                        <input
                            style={styles.input}
                            placeholder="Player name"
                            value={newPlayerName}
                            onChange={(e) => setNewPlayerName(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && addPlayer()}
                        />
                        <button style={styles.button} onClick={addPlayer}>
                            Add
                        </button>
                    </div>

                    <div style={styles.box}>
                        <p>
                            <strong>Leader Link</strong>
                        </p>
                        <p style={styles.linkText}>{buildHostLink()}</p>
                        <button
                            style={styles.buttonOutline}
                            onClick={() => copyText(buildHostLink())}
                        >
                            Copy Leader Link
                        </button>
                    </div>

                    <hr style={{ margin: "20px 0" }} />

                    {appState.players.length === 0 && <p>No players yet</p>}

                    {appState.players.map((player) => (
                        <div key={player.id} style={styles.box}>
                            <div style={styles.rowBetween}>
                                <strong>{player.name}</strong>
                                <div style={styles.row}>
                                    <button
                                        style={styles.buttonOutline}
                                        onClick={() => copyText(buildPlayerLink(player.id))}
                                    >
                                        Copy Link
                                    </button>
                                    <button
                                        style={styles.buttonOutline}
                                        onClick={() => removePlayer(player.id)}
                                    >
                                        Remove
                                    </button>
                                </div>
                            </div>
                            <p style={styles.linkText}>{buildPlayerLink(player.id)}</p>
                        </div>
                    ))}
                </div>
            </div>
        </main>
    );
}

const styles = {
    page: {
        minHeight: "100vh",
        background: "#f8fafc",
        padding: "24px",
        fontFamily: "Arial, sans-serif",
    },
    container: {
        maxWidth: "900px",
        margin: "0 auto",
    },
    containerSmall: {
        maxWidth: "500px",
        margin: "0 auto",
    },
    card: {
        background: "#fff",
        borderRadius: "18px",
        padding: "24px",
        boxShadow: "0 8px 30px rgba(0,0,0,0.08)",
    },
    section: {
        marginTop: "24px",
    },
    row: {
        display: "flex",
        gap: "10px",
        flexWrap: "wrap",
        alignItems: "center",
    },
    rowBetween: {
        display: "flex",
        justifyContent: "space-between",
        gap: "10px",
        flexWrap: "wrap",
        alignItems: "center",
    },
    input: {
        flex: 1,
        minWidth: "220px",
        padding: "12px",
        borderRadius: "10px",
        border: "1px solid #ccc",
        fontSize: "16px",
    },
    button: {
        padding: "12px 18px",
        borderRadius: "10px",
        border: "none",
        background: "#111827",
        color: "#fff",
        cursor: "pointer",
        fontSize: "15px",
    },
    buttonOutline: {
        padding: "12px 18px",
        borderRadius: "10px",
        border: "1px solid #ccc",
        background: "#fff",
        cursor: "pointer",
        fontSize: "15px",
    },
    buttonDisabled: {
        padding: "12px 18px",
        borderRadius: "10px",
        border: "none",
        background: "#9ca3af",
        color: "#fff",
        cursor: "not-allowed",
        fontSize: "15px",
    },
    box: {
        marginTop: "16px",
        padding: "16px",
        border: "1px solid #e5e7eb",
        borderRadius: "14px",
        background: "#fff",
    },
    checkboxRow: {
        display: "flex",
        gap: "10px",
        alignItems: "center",
        padding: "10px 0",
    },
    roleBox: {
        marginTop: "20px",
        padding: "32px",
        border: "1px solid #e5e7eb",
        borderRadius: "16px",
        textAlign: "center",
        background: "#fff",
    },
    smallLabel: {
        fontSize: "13px",
        color: "#6b7280",
        textTransform: "uppercase",
        letterSpacing: "1px",
        marginBottom: "8px",
    },
    bigText: {
        fontSize: "32px",
        fontWeight: "bold",
    },
    linkText: {
        wordBreak: "break-all",
        color: "#475569",
    },
};