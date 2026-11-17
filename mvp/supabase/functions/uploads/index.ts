import { uploadsHandler } from "../_shared/uploads-handler.ts";
Deno.serve(uploadsHandler((name) => Deno.env.get(name)));
