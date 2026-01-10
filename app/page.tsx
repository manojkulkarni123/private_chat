'use client';
import { useEffect, useState } from "react";
import { nanoid } from "nanoid";
import { useRouter } from "next/navigation"
import { createRoom } from "@/lib/client"

const ANIMALS = ["wolf", "lion", "elephant", "tiger"]
const STORAGE_KEY = "chat_username"

const generateUsername = () => {
  const word = ANIMALS[Math.floor(Math.random() * ANIMALS.length)]
  return `anonymous-${word}-${nanoid(5)}`
}

export default function Home() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("")
  const [creating, setCreating] = useState(false)
  const [joinId, setJoinId] = useState("")
  const router = useRouter()

  useEffect(() => {
    const main = () => {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) {
        setUsername(stored)
        return
      }
      const generated = generateUsername()
      localStorage.setItem(STORAGE_KEY, generated)
      setUsername(generated)
    }
    main()
  }, [])

  return <main className="flex min-h-screen flex-col items-center justify-center p-4">
    <div className="w-full max-w-md space-y-8">
      <div className="text-center space-y-2">
        <h1 className="text-2xl font-bold tracking-tight text-green-500">
          {">"}private chat
        </h1>
        <p className="text-zinc-500 text-sm">A private, self-destructing chat room. </p>
      </div>

      <div className="border border-zinc-800 bg-zinc-900/50 p-6 backdrop-blur-md">
        <div className="space-y-6">
          {/* CREATE SECTION */}
          <div className="space-y-5">
            <div className="space-y-2">
              <label className="flex items-center text-zinc-500 text-xs uppercase tracking-widest">Your Identity</label>
              <div className="flex items-center gap-3">
                <div className="flex-1 bg-zinc-950 border-zinc-800 p-3 text-sm text-zinc-400 font-mono">
                  {username}
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <label className="flex items-center text-zinc-500 text-xs uppercase tracking-widest">
                Room Password <span className="ml-2 text-[10px] opacity-40">(Optional)</span>
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full bg-zinc-950 border border-zinc-800 p-3 text-sm text-zinc-100 placeholder:text-zinc-700 focus:outline-none focus:border-green-900 transition-colors"
              />
            </div>

            <button
              disabled={creating}
              onClick={async () => {
                try {
                  setCreating(true)
                  const room = await createRoom(password)
                  // HANDOVER: Store password temporarily for auto-entry on redirect
                  if (password) {
                    sessionStorage.setItem(`pending_pass_${room.roomId}`, password)
                  }
                  router.push(`/room/${room.roomId}`)
                }
                catch {
                  setCreating(false)
                  alert("Failed to create room")
                }
              }}
              className="w-full bg-zinc-100 text-black p-3 test-sm font-bold hover:bg-zinc-50 hover:text-black transition-colors mt-2 cursor-pointer disabled:opacity-50">
              CREATE SECURE ROOM
            </button>
          </div>

          <div className="h-px bg-zinc-800/50 my-2" />

          {/* JOIN SECTION */}
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="flex items-center text-zinc-500 text-xs uppercase tracking-widest">Join by Room ID</label>
              <input
                type="text"
                value={joinId}
                onChange={(e) => setJoinId(e.target.value)}
                placeholder="Paste Room ID here..."
                className="w-full bg-zinc-950 border border-zinc-800 p-3 text-sm text-zinc-100 placeholder:text-zinc-700 focus:outline-none focus:border-zinc-700 transition-colors"
              />
            </div>

            <button
              disabled={!joinId.trim()}
              onClick={() => router.push(`/room/${joinId.trim()}`)}
              className="w-full bg-zinc-800 text-zinc-400 p-3 text-sm font-bold hover:bg-zinc-700 hover:text-zinc-200 transition-colors cursor-pointer disabled:opacity-50">
              JOIN EXISTING ROOM
            </button>
          </div>
        </div>
      </div>
    </div>
  </main>
}