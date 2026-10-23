import { accountHandler } from "../_shared/account-handler.ts";
Deno.serve(accountHandler((name) => Deno.env.get(name)));
