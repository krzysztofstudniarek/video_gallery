import { createBrowserRouter } from "react-router";
import { PrintPage } from "../routes/print/PrintPage";
import { UploadsPage } from "../routes/uploads/UploadsPage";
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
      path: "uploads/:jobId?",
      caseSensitive: true,
      element: <UploadsPage />,
      handle: { title: "Upload to YouTube" },
    },
    {
      path: "workflows/:workflowId/print",
      caseSensitive: true,
      element: <PrintPage />,
      handle: { title: "Download and print" },
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
