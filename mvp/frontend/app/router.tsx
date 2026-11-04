import { createBrowserRouter } from "react-router";
import { App } from "./App";
import { HomePage } from "../routes/home/HomePage";
import { VideosPage } from "../routes/videos/VideosPage";
import { AccountPage } from "../routes/account/AccountPage";
import { ToolsPage } from "../routes/tools/ToolsPage";
import { NotFoundPage } from "../routes/NotFoundPage";

export const router = createBrowserRouter([{
  element: <App />,
  children: [
    { index: true, element: <HomePage />, handle: { title: "Home" } },
    {
      path: "videos",
      caseSensitive: true,
      element: <VideosPage />,
      handle: { title: "Your videos" },
    },
    {
      path: "account",
      caseSensitive: true,
      element: <AccountPage />,
      handle: { title: "Account" },
    },
    {
      path: "tools",
      caseSensitive: true,
      element: <ToolsPage />,
      handle: { title: "Validation tools" },
    },
    { id: "not-found", path: "*", element: <NotFoundPage />, handle: { title: "Page not found" } },
  ],
}], { basename: import.meta.env.BASE_URL });
