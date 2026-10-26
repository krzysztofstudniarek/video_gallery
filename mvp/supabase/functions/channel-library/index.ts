import { channelLibraryHandler } from "../_shared/channel-library-handler.ts";
Deno.serve(channelLibraryHandler((name) => Deno.env.get(name)));
