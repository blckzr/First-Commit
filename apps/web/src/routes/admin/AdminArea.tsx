import { Route, Routes } from "react-router";
import { AdminShell } from "../../app/AdminShell";
import { Overview } from "./Overview";
import { Flags } from "./Flags";
import { Reviews } from "./Reviews";
import { Certificates } from "./Certificates";
import { Modules } from "./Modules";
import { ModuleEditor } from "./ModuleEditor";
import { CareerPaths } from "./CareerPath";
import { Briefs } from "./Briefs";
import { Analytics } from "./Analytics";
import { Users } from "./Users";
import { Settings } from "./Settings";
import { ActivityLog } from "./ActivityLog";

/**
 * The admin area, in its own lazily-loaded chunk so a learner's browser never
 * downloads admin screens (design.md §4.3).
 *
 * **Every route the sidebar offers is now a real screen.** Overview, Career
 * paths, Modules, Capstone projects, Project reviews, Flagged AI feedback,
 * Analytics, Certificates, Users, Settings and the Activity log — no
 * `Placeholder` is left in the admin tree.
 *
 * What is still missing inside these screens is named on the screens
 * themselves and tracked in docs/task-tracker.md: §6.2's drag-and-drop
 * placement, §6.5's check editor, §6.3's "Preview as learner", §6.10's data
 * requests and §6.11's prompt testing. Each says so where an admin would look
 * for it, rather than being absent without explanation.
 */
export default function AdminArea() {
  return (
    <Routes>
      <Route element={<AdminShell />}>
        <Route index element={<Overview />} />
        <Route path="paths" element={<CareerPaths />} />
        <Route path="modules" element={<Modules />} />
        <Route path="modules/:moduleId" element={<ModuleEditor />} />
        <Route path="briefs" element={<Briefs />} />
        <Route path="reviews" element={<Reviews />} />
        <Route path="flags" element={<Flags />} />
        <Route path="analytics" element={<Analytics />} />
        <Route path="certificates" element={<Certificates />} />
        <Route path="users" element={<Users />} />
        <Route path="settings" element={<Settings />} />
        <Route path="log" element={<ActivityLog />} />
      </Route>
    </Routes>
  );
}
