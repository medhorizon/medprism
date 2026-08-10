import { BrowserRouter, HashRouter } from "react-router-dom";
import { LocaleProvider } from "../i18n/context";
import { AppRoutes } from "./routes";

/** Packaged Electron loads dist via file://; BrowserRouter cannot route that URL. */
const Router = window.location.protocol === "file:" ? HashRouter : BrowserRouter;

export default function App() {
  return (
    <LocaleProvider>
      <Router>
        <AppRoutes />
      </Router>
    </LocaleProvider>
  );
}
