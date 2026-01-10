export async function createRoom(password?: string): Promise<{ roomId: string }> {
  const res = await fetch("/api/room", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password })
  })
  return res.json()
}
