import { NextRequest, NextResponse } from "next/server"
import { redis } from "./lib/redis"
import { nanoid } from "nanoid"

export const proxy = async (req: NextRequest) => {
  const pathname = req.nextUrl.pathname

  const roomMatch = pathname.match(/^\/room\/([^/]+)$/)
  if (!roomMatch) return NextResponse.redirect(new URL("/", req.url))

  const roomId = roomMatch[1]

  const metaRaw = await redis.hgetall<any>(`meta:${roomId}`)

  if (!metaRaw) {
    return NextResponse.redirect(new URL("/?error=room-not-found", req.url))
  }

  let connected: string[] = []
  if (metaRaw.connected) {
    if (typeof metaRaw.connected === "string") {
      try {
        connected = JSON.parse(metaRaw.connected)
      } catch {
        connected = []
      }
    } else if (Array.isArray(metaRaw.connected)) {
      connected = metaRaw.connected
    }
  }

  console.log("Proxy: connected list:", connected)

  const existingToken = req.cookies.get("x-auth-token")?.value

  // USER IS ALLOWED TO JOIN ROOM
  if (existingToken && connected.includes(existingToken)) {
    console.log("User rejoining with existing token")
    return NextResponse.next()
  }

  // USER IS NOT ALLOWED TO JOIN
  if (connected.length >= 2) {
    console.log("Room full")
    return NextResponse.redirect(new URL("/?error=room-full", req.url))
  }

  const response = NextResponse.next()
  const token = nanoid()

  response.cookies.set("x-auth-token", token, {
    path: "/",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
  })

  const updatedConnected = [...connected, token]
  console.log("Adding token, new connected:", updatedConnected)

  await redis.hset(`meta:${roomId}`, {
    connected: JSON.stringify(updatedConnected),
  })

  return response
}

export const config = {
  matcher: "/room/:path*",
}