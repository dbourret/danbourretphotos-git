export default function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const appId = process.env.SQUARE_APP_ID;
  const locationId = process.env.SQUARE_LOCATION_ID;
  const environment = process.env.SQUARE_ENV || "sandbox";

  if (!appId || !locationId) {
    return res.status(500).json({
      error: "Missing Square configuration"
    });
  }

  return res.status(200).json({
    appId,
    locationId,
    environment
  });
}