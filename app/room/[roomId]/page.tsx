'use client';

import { useParams, useRouter } from "next/navigation";
import { useRef, useState, useEffect } from "react";
import { io, Socket } from "socket.io-client";
import { deriveKey, encryptMessage, decryptMessage } from "@/lib/crypto";

interface FeedItem {
    id: string
    type: 'message' | 'system'
    username?: string
    content: string
    timestamp: number
    isOwn?: boolean
}

const ANIMALS = ["wolf", "lion", "elephant", "tiger"]
const generateUsername = () => {
    const word = ANIMALS[Math.floor(Math.random() * ANIMALS.length)]
    return `anonymous-${word}-${Math.random().toString(36).substring(2, 7)}`
}

const Page = () => {
    const params = useParams()
    const router = useRouter()
    const roomId = params.roomId as string

    const [username, setUsername] = useState("")

    // UI State
    const [input, setInput] = useState("")
    const inputRef = useRef<HTMLInputElement>(null)
    const [copyStatus, setCopyStatus] = useState("COPY")
    const [timeRemaining, setTimeRemaining] = useState<number | null>(null)

    const [feed, setFeed] = useState<FeedItem[]>([])
    const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting')
    const [showDestroyModal, setShowDestroyModal] = useState(false)

    // Security & Encryption State
    const [isPasswordRequired, setIsPasswordRequired] = useState(false)
    const [roomPassword, setRoomPassword] = useState("")
    const [encryptionKey, setEncryptionKey] = useState<CryptoKey | null>(null)
    const [passwordError, setPasswordError] = useState("")
    const [hasStoredName, setHasStoredName] = useState(false)
    const [authState, setAuthState] = useState<'initializing' | 'gate' | 'authenticated'>('initializing')

    const socketRef = useRef<Socket | null>(null)
    const messagesEndRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
    }, [feed])

    useEffect(() => {
        const stored = localStorage.getItem("chat_username")
        if (stored) {
            setUsername(stored)
            setHasStoredName(true)
        }

        let isMounted = true
        let socketInstance: Socket | null = null

        const setup = async () => {
            try {
                // 1. Fetch Room Metadata
                const res = await fetch(`/api/room/${roomId}/meta`)
                if (!res.ok) {
                    if (res.status === 404) router.push('/?error=room-not-found')
                    return
                }
                const meta = await res.json()
                if (!isMounted) return

                setIsPasswordRequired(meta.passwordRequired)

                // 2. Suffix-Only Enforcement (V2.5.2): Zero-Friction Trust
                const isSecure = roomId.endsWith("-s")

                // CREATOR VIP PASS: Check if we just created this room
                const pendingPass = sessionStorage.getItem(`pending_pass_${roomId}`)
                if (pendingPass && !encryptionKey) {
                    try {
                        const key = await deriveKey(pendingPass, roomId)
                        setEncryptionKey(key)
                        setRoomPassword(pendingPass)
                        sessionStorage.removeItem(`pending_pass_${roomId}`) // Clean up
                        setAuthState('authenticated')
                        return
                    } catch (e) {
                        // Fallback to gate if auto-entry fails
                    }
                }

                if (isSecure) {
                    if (!encryptionKey) {
                        setAuthState('gate')
                        return
                    }
                } else {
                    // Base E2EE for public rooms
                    if (!encryptionKey) {
                        const key = await deriveKey("v21-base-" + roomId, roomId)
                        if (!isMounted) return
                        setEncryptionKey(key)
                        return
                    }
                }

                // 3. Finalize Authentication
                setAuthState('authenticated')

                // 4. Connect Socket (ONLY if we have identity and key)
                if (!stored || !encryptionKey) return

                const wsUrl = process.env.NEXT_PUBLIC_WS_URL || 'http://localhost:8080'
                socketInstance = io(wsUrl, {
                    query: {
                        roomId,
                        username: stored,
                        password: roomPassword
                    }
                })

                socketRef.current = socketInstance

                socketInstance.on('connect', () => {
                    if (isMounted) {
                        setConnectionStatus('connected')
                    }
                })

                socketInstance.on('disconnect', () => {
                    if (isMounted) setConnectionStatus('disconnected')
                })

                socketInstance.on('error', (error: { message: string }) => {
                    if (!isMounted) return
                    if (error.message === 'Password required') {
                        setEncryptionKey(null) // Reset key to trigger portal
                        setPasswordError("Invalid room password.")
                    } else {
                        router.push(`/?error=${encodeURIComponent(error.message)}`)
                    }
                })

                // 4. Handle Feed Logic
                socketInstance.on('receive-message', async (data: { username: string; content: string; timestamp: number }) => {
                    if (!isMounted) return
                    let displayContent = data.content

                    // Attempt decryption with current key
                    if (encryptionKey) {
                        try {
                            displayContent = await decryptMessage(data.content, encryptionKey)
                        } catch (e) {
                            displayContent = "[Encrypted Content]"
                        }
                    }

                    setFeed(prev => [...prev, {
                        id: crypto.randomUUID(),
                        type: 'message',
                        username: data.username,
                        content: displayContent,
                        timestamp: data.timestamp,
                        isOwn: false
                    } as FeedItem])
                })

                socketInstance.on('user-joined', (data: { username: string }) => {
                    if (!isMounted) return
                    setFeed(prev => [...prev, {
                        id: crypto.randomUUID(),
                        type: 'system',
                        content: `${data.username} joined the room`,
                        timestamp: Date.now()
                    } as FeedItem].slice(-100)) // Keep feed manageable
                })

                socketInstance.on('user-left', (data: { username: string }) => {
                    if (!isMounted) return
                    setFeed(prev => [...prev, {
                        id: crypto.randomUUID(),
                        type: 'system',
                        content: `${data.username} left the room`,
                        timestamp: Date.now()
                    } as FeedItem].slice(-100))
                })

            } catch (error) {
                console.error('Connection failed:', error)
            }
        }

        setup()

        return () => {
            isMounted = false
            if (socketInstance) {
                socketInstance.disconnect()
            }
            socketRef.current = null
        }
    }, [roomId, router, encryptionKey])

    useEffect(() => {
        let interval: NodeJS.Timeout

        const fetchTimer = async () => {
            try {
                const res = await fetch(`/api/room/${roomId}/meta`)
                if (!res.ok) return

                const { createdAt, ttl } = await res.json()

                const expiryTimestamp = Date.now() + (ttl * 1000)

                interval = setInterval(() => {
                    const remaining = Math.max(0, Math.floor((expiryTimestamp - Date.now()) / 1000))
                    setTimeRemaining(remaining)

                    if (remaining === 0) {
                        router.push('/?error=room-expired')
                    }
                }, 1000)
            } catch (error) {
            }
        }

        fetchTimer()

        return () => {
            if (interval) clearInterval(interval)
        }
    }, [roomId, router])

    const sendMessage = async () => {
        if (!input.trim() || !socketRef.current || !encryptionKey) return

        const messageText = input
        setInput("")

        let contentToSend = messageText

        try {
            contentToSend = await encryptMessage(messageText, encryptionKey)
        } catch (e) {
            return
        }

        socketRef.current.emit('send-message', { content: contentToSend })

        setFeed(prev => [...prev, {
            id: crypto.randomUUID(),
            type: 'message',
            username,
            content: messageText,
            timestamp: Date.now(),
            isOwn: true
        } as FeedItem])

        inputRef.current?.focus()
    }

    const handleJoinPortal = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!username.trim()) return

        setPasswordError("")
        localStorage.setItem("chat_username", username)

        try {
            const isSecure = roomId.endsWith("-s")

            if (isSecure) {
                const key = await deriveKey(roomPassword, roomId)
                setEncryptionKey(key)
                setAuthState('authenticated')
            } else {
                const key = await deriveKey("v21-base-" + roomId, roomId)
                setEncryptionKey(key)
                setAuthState('authenticated')
            }
        } catch (e) {
            setPasswordError("Security failure. Please refresh.")
        }
    }

    function formatTimeRemaining(seconds: number) {
        const mins = Math.floor(seconds / 60)
        const secs = seconds % 60
        return `${mins}:${secs.toString().padStart(2, "0")}`
    }

    const destroyRoom = () => {
        setShowDestroyModal(true)
    }

    const confirmDestroy = async () => {
        try {
            await fetch(`/api/room/${roomId}/destroy`, { method: 'POST' })
            if (socketRef.current) socketRef.current.disconnect()
            router.push('/?message=room-destroyed')
        } catch (error) {
            alert('Failed to destroy room')
        }
    }

    const copyLink = () => {
        navigator.clipboard.writeText(roomId)
        setCopyStatus("COPIED ID!")
        setTimeout(() => setCopyStatus("COPY"), 2000)
    }

    if (authState !== 'authenticated' || !username) {
        return <main className="flex min-h-screen flex-col items-center justify-center p-4 bg-black">
            <div className="w-full max-w-sm space-y-8 animate-in fade-in zoom-in duration-500">
                <div className="text-center space-y-3">
                    <div className="text-4xl text-green-500 font-mono animate-pulse">{authState === 'initializing' ? "---" : "🔐"}</div>
                    <div className="space-y-1">
                        <h2 className="text-xl font-black text-white uppercase tracking-tighter">
                            {authState === 'initializing' ? "Initializing..." : "Secure Entry"}
                        </h2>
                        <p className="text-[10px] text-zinc-500 uppercase tracking-widest font-mono">Room: {roomId}</p>
                    </div>
                </div>

                {authState === 'initializing' ? (
                    <div className="text-center py-10">
                        <div className="text-[10px] text-zinc-600 uppercase tracking-[0.5em] animate-pulse">Establishing Secure Tunnel...</div>
                    </div>
                ) : (
                    <div className="border border-zinc-800 bg-zinc-900/50 p-6 backdrop-blur-md space-y-6">
                        <form onSubmit={handleJoinPortal} className="space-y-6">
                            {!hasStoredName && (
                                <div className="space-y-2">
                                    <label className="flex items-center justify-between text-zinc-600 text-[10px] uppercase tracking-widest font-bold">
                                        Identity Pseudonym
                                        <button
                                            type="button"
                                            onClick={() => setUsername(generateUsername())}
                                            className="text-green-600 hover:text-green-400 transition-colors text-[9px]"
                                        >
                                            [RANDOMIZE]
                                        </button>
                                    </label>
                                    <input
                                        autoFocus
                                        type="text"
                                        placeholder="e.g. anonymous-wolf"
                                        value={username}
                                        onChange={(e) => setUsername(e.target.value)}
                                        className="w-full bg-black border border-zinc-800 p-3 text-sm text-zinc-100 placeholder:text-zinc-800 focus:outline-none focus:border-green-600 transition-colors"
                                    />
                                </div>
                            )}

                            {roomId.endsWith("-s") && (
                                <div className="space-y-2">
                                    <label className="text-zinc-600 text-[10px] uppercase tracking-widest font-bold">Session Password</label>
                                    <input
                                        type="password"
                                        placeholder="••••••••"
                                        value={roomPassword}
                                        autoFocus={hasStoredName}
                                        onChange={(e) => setRoomPassword(e.target.value)}
                                        className="w-full bg-black border border-zinc-800 p-3 text-sm text-zinc-100 placeholder:text-zinc-800 focus:outline-none focus:border-green-600 transition-colors"
                                    />
                                </div>
                            )}

                            {passwordError && (
                                <p className="text-[10px] text-red-500 font-mono text-center animate-pulse">{passwordError}</p>
                            )}

                            <button
                                type="submit"
                                disabled={!username.trim()}
                                className="w-full bg-green-600 hover:bg-green-500 text-white font-black py-4 rounded text-xs uppercase tracking-[0.2em] transition-all transform active:scale-95 disabled:opacity-50"
                            >
                                {roomId.endsWith("-s") ? "Unlock & Join" : "Securely Enter"}
                            </button>
                        </form>

                        <button
                            onClick={() => router.push('/')}
                            className="w-full text-zinc-700 text-[10px] uppercase hover:text-zinc-500 transition-colors tracking-widest font-mono"
                        >
                            {"<"} Return to Lobby
                        </button>
                    </div>
                )}

                <div className="text-center pt-4">
                    <p className="text-[9px] text-zinc-800 uppercase tracking-[0.3em]">Privacy-First Ephemeral Messaging</p>
                </div>
            </div>
        </main>
    }

    return <main className="flex flex-col h-screen max-h-screen overflow-hidden">
        <header className="border-b border-zinc-800 p-3 sm:p-4 flex items-center justify-between bg-zinc-900/30">
            <div className="flex items-center gap-2 sm:gap-4 overflow-hidden">
                <div className="flex flex-col min-w-0">
                    <span className="text-[10px] text-zinc-500 uppercase hidden sm:block">Room ID</span>
                    <div className="flex items-center gap-2">
                        <span className="font-bold text-green-500 truncate text-sm sm:text-base">{roomId}</span>
                        <button onClick={copyLink} className="text-[9px] sm:text-[10px] bg-zinc-800 hover:bg-zinc-700 px-1.5 sm:px-2 py-0.5 rounded text-zinc-400 shrink-0 transition-colors uppercase">{copyStatus === "COPY" ? "ID" : "OK"}</button>
                    </div>
                </div>

                <div className="h-8 w-px bg-zinc-800 shrink-0" />

                <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
                    <div className={`w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full ${connectionStatus === 'connected' ? 'bg-green-500' : connectionStatus === 'connecting' ? 'bg-yellow-500 animate-pulse' : 'bg-red-500'}`} />
                    <span className="text-[10px] sm:text-xs text-zinc-500 capitalize">{connectionStatus}</span>
                </div>

                <div className="h-8 w-px bg-zinc-800 shrink-0 hidden xs:block" />

                <div className="flex-col hidden xs:flex shrink-0">
                    <span className="text-[10px] text-zinc-500 uppercase hidden sm:block">Self-Destruct</span>
                    <span className={`text-xs sm:text-sm font-bold flex items-center gap-2 ${timeRemaining !== null && timeRemaining < 60 ? "text-red-500" : "text-amber-500"}`}>
                        {timeRemaining !== null ? formatTimeRemaining(timeRemaining) : "--:--"}
                    </span>
                </div>
            </div>

            <button
                onClick={destroyRoom}
                className="text-[10px] sm:text-xs bg-zinc-800 hover:bg-red-600 px-2 sm:px-3 py-1.5 
                rounded text-zinc-400 hover:text-white font-bold transition-all group
                flex items-center gap-1.5 sm:gap-2 shrink-0">
                <span className="group-hover:animate-pulse">💣</span>
                <span className="hidden xs:inline">DESTROY</span>
                <span className="inline xs:hidden">BURN</span>
            </button>
        </header>

        <div className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-thin">
            {feed.map((item) => (
                <div key={item.id}>
                    {item.type === 'system' ? (
                        <div className="text-center text-[10px] text-zinc-600 uppercase tracking-widest py-2 animate-in fade-in slide-in-from-top-1 duration-500">
                            {item.content}
                        </div>
                    ) : (
                        <div className={`flex ${item.isOwn ? 'justify-end' : 'justify-start'} animate-in fade-in slide-in-from-bottom-1 duration-300`}>
                            <div className={`max-w-[70%] rounded-lg p-3 ${item.isOwn ? 'bg-green-600 text-white' : 'bg-zinc-800 text-zinc-100'}`}>
                                <div className="text-[10px] opacity-70 mb-1 font-mono uppercase tracking-tighter">{item.username}</div>
                                <div className="text-sm break-words whitespace-pre-wrap">{item.content}</div>
                                <div className={`text-[9px] opacity-40 mt-1 font-mono`}>
                                    {new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            ))}
            <div ref={messagesEndRef} />
        </div>

        <div className="p-3 sm:p-4 border-t border-zinc-800 bg-zinc-900/30">
            <div className="flex gap-2 sm:gap-4">
                <div className="flex-1 relative group">
                    <span className="absolute left-3 sm:left-4 top-1/2 -translate-y-1/2 text-green-500 animate-pulse text-sm sm:text-base ">{">"}</span>
                    <input
                        ref={inputRef}
                        autoFocus
                        type="text"
                        value={input}
                        onKeyDown={(e) => {
                            if (e.key === "Enter" && input.trim()) {
                                sendMessage()
                            }
                        }}
                        placeholder={encryptionKey ? "Encrypted message..." : "Wait..."}
                        disabled={!encryptionKey}
                        onChange={(e) => setInput(e.target.value)}
                        className="w-full bg-black border border-zinc-800 focus:border-zinc-700 focus:outline-none
                        transition-colors text-zinc-100 placeholder:text-zinc-700 py-2.5 sm:py-3 pl-7 sm:pl-8 pr-3 sm:pr-4 text-sm disabled:opacity-50"
                    />
                </div>

                <button
                    onClick={sendMessage}
                    disabled={!input.trim() || !encryptionKey}
                    className="bg-zinc-100 text-black px-4 sm:px-6 text-xs sm:text-sm font-bold 
                    hover:bg-white transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer shrink-0">
                    SEND
                </button>
            </div>
        </div>


        {showDestroyModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
                <div className="bg-zinc-900 border border-zinc-800 rounded-xl max-w-md w-full overflow-hidden shadow-2xl animate-in fade-in zoom-in duration-300">
                    <div className="relative h-56 w-full flex items-center justify-center overflow-hidden bg-zinc-800">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                            src="/disaster-girl-hed-2017.webp"
                            alt="Disaster Girl Meme"
                            className="w-full h-full object-cover"
                            onError={(e) => {
                                (e.target as HTMLImageElement).src = "/disaster-girl-hed-2017.svg"
                            }}
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-zinc-900 via-transparent to-transparent opacity-60" />
                        <div className="absolute bottom-4 left-6 drop-shadow-xl">
                            <h2 className="text-2xl font-black text-white uppercase tracking-tighter italic">Burn the Evidence?</h2>
                            <p className="text-[10px] font-bold text-zinc-300 uppercase tracking-widest">Permanent Destruction Sequence</p>
                        </div>
                    </div>

                    <div className="p-6 space-y-4">
                        <p className="text-sm text-zinc-300 leading-relaxed">
                            Are you absolutely sure you want to incinerate this room? All messages will be lost forever in the digital void.
                        </p>

                        <div className="flex gap-3 pt-2">
                            <button
                                onClick={() => setShowDestroyModal(false)}
                                className="flex-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-bold py-3 rounded-lg transition-colors uppercase tracking-widest cursor-pointer"
                            >
                                Wait, No!
                            </button>
                            <button
                                onClick={confirmDestroy}
                                className="flex-1 bg-red-600 hover:bg-red-700 text-white text-xs font-bold py-3 rounded-lg transition-all transform hover:scale-[1.02] active:scale-[0.98] uppercase tracking-widest cursor-pointer"
                            >
                                Burn It! 💣
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        )}
    </main>

}

export default Page
