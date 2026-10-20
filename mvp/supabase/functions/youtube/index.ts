import { youtubeHandler } from "../_shared/youtube-handler.ts";
Deno.serve(youtubeHandler((name) => Deno.env.get(name)));
