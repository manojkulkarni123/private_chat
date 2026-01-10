import { redis } from "@/lib/redis"
import { NextRequest } from "next/server"

export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ roomId: string }> }
) {
    const { roomId } = await params

    try {
        // Delete room metadata from Redis
        await redis.del(`meta:${roomId}`)

        return Response.json({ success: true })
    } catch (error) {
        console.error('Error destroying room:', error)
        return Response.json({ error: 'Failed to destroy room' }, { status: 500 })
    }
}
