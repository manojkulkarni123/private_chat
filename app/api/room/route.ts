import { redis } from "@/lib/redis"
import { NextRequest } from "next/server"

const ROOM_TTL_SECONDS = 60 * 10
const RATE_LIMIT_LIMIT = 3
const RATE_LIMIT_WINDOW = 60 // 1 minute

export async function POST(req: NextRequest) {
  // SECURITY: Basic Rate Limiting by IP
  const ip = req.headers.get("x-forwarded-for") || "anonymous"
  const rateLimitKey = `ratelimit:room:${ip}`

  const currentRequests = await redis.incr(rateLimitKey)
  if (currentRequests === 1) {
    await redis.expire(rateLimitKey, RATE_LIMIT_WINDOW)
  }

  if (currentRequests > RATE_LIMIT_LIMIT) {
    return Response.json(
      { error: "Too many room creations. Please wait a minute." },
      { status: 429 }
    )
  }

  // Parse password if exists
  let password = null
  try {
    const body = await req.json()
    password = body.password
  } catch (e) {
    // Body might be empty
  }

  let roomId = crypto.randomUUID()

  const metaData: any = {
    connected: JSON.stringify([]),
    createdAt: Date.now(),
  }

  if (password) {
    roomId += "-s" // Secure suffix
    metaData.password = password
    metaData.passwordRequired = "true"
  } else {
    roomId += "-p" // Public suffix
  }

  await redis.hset(`meta:${roomId}`, metaData)
  await redis.expire(`meta:${roomId}`, ROOM_TTL_SECONDS)

  return Response.json({
    roomId,
  })
}