import { BrowserRouter } from "react-router-dom";
import { LocaleProvider } from "../i18n/context";
import { AppRoutes } from "./routes";

export default function App() {
  return (
    <LocaleProvider>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </LocaleProvider>
  );
}
