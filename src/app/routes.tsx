import { Navigate, Route, Routes } from "react-router-dom";
import { LoginPage } from "../pages/LoginPage";
import { ProjectsPage } from "../pages/ProjectsPage";
import { WorkspacePage } from "../pages/WorkspacePage";

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/projects" replace />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/projects" element={<ProjectsPage />} />
      <Route path="/p/:projectId" element={<WorkspacePage />} />
      <Route path="*" element={<Navigate to="/projects" replace />} />
    </Routes>
  );
}
