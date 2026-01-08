import { redis } from "@/lib/redis"

const ROOM_TTL_SECONDS = 60*10

export async function POST() {
  console.log("CREATE A ROOM")
  const roomId = crypto.randomUUID()

  await redis.hset(`meta:${roomId}`,{
    connected: [],
    createdAt: Date.now(),
  })
  
  await redis.expire(`meta:${roomId}`, ROOM_TTL_SECONDS )
  
  return Response.json({
    roomId,
  })
}
