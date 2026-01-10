import { redis } from "@/lib/redis"
import { NextRequest } from "next/server"

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ roomId: string }> }
) {
    const { roomId } = await params

    // Get room metadata from Redis
    const meta = await redis.hgetall(`meta:${roomId}`)

    if (!meta || Object.keys(meta).length === 0) {
        return Response.json({ error: 'Room not found' }, { status: 404 })
    }

    // Get TTL (time to live) in seconds
    const ttl = await redis.ttl(`meta:${roomId}`)

    return Response.json({
        createdAt: Number(meta.createdAt),
        ttl: ttl > 0 ? ttl : 0,
        passwordRequired: meta.passwordRequired === "true"
    })
}
