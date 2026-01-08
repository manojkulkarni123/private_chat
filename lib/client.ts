export async function createRoom(): Promise<{ roomId: string }> {
  const res = await fetch("/api/room", { method: "POST" })
  return res.json()
}
