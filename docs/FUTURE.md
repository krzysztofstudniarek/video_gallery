# Future album flow

Owner direction recorded on 26 October 2026, after the minimal scope of #5:

- Keep the current flow simple: upload videos or choose existing Unlisted videos from the connected
  YouTube channel, then select individual videos for QR codes.
- In a future iteration, require users to create an album first and group their chosen videos in it.
- Generate one QR code for the whole album, rather than requiring a separate code for each video.

Albums are organized in VideoAlbum. Reading YouTube's automatic uploads playlist is only an API
discovery mechanism; it does not create or edit user-managed YouTube playlists.

The album flow is future work, not part of the current management screen. Before implementing it,
decide what the album code opens and how that destination survives changes, disconnect, account
deletion and app outages. A single-video YouTube watch URL cannot represent a collection. This
requires a separate destination/lifecycle decision; it does not silently replace the current
[direct video QR contract](ADR-002-direct-youtube-qr.md) or introduce app-hosted album pages now.
