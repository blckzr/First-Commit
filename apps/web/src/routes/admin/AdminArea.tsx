import { Route, Routes } from "react-router";
import { AdminShell } from "../../app/AdminShell";
import { Overview } from "./Overview";
import { Placeholder } from "./Placeholder";

/**
 * The admin area, in its own lazily-loaded chunk so a learner's browser never
 * downloads admin screens (design.md §4.3).
 *
 * Only Overview is built. The other ten screens are specified in design.md §6
 * and tracked in docs/task-tracker.md; each renders a placeholder naming what
 * belongs there, so the sidebar is walkable while the shell is reviewed.
 */
export default function AdminArea() {
  return (
    <Routes>
      <Route element={<AdminShell />}>
        <Route index element={<Overview />} />
        <Route path="paths" element={<Placeholder title="Career paths" section="section 6.2" />} />
        <Route path="modules" element={<Placeholder title="Modules" section="section 6.3" />} />
        <Route path="briefs" element={<Placeholder title="Capstone projects" section="section 6.4" />} />
        <Route path="reviews" element={<Placeholder title="Project reviews" section="section 6.5" />} />
        <Route path="flags" element={<Placeholder title="Flagged AI feedback" section="section 6.8" />} />
        <Route path="analytics" element={<Placeholder title="Analytics" section="section 6.9" />} />
        <Route path="certificates" element={<Placeholder title="Certificates" section="section 6.7" />} />
        <Route path="users" element={<Placeholder title="Users" section="section 6.10" />} />
        <Route path="settings" element={<Placeholder title="Settings" section="section 6.11" />} />
        <Route path="log" element={<Placeholder title="Activity log" section="section 6.12" />} />
      </Route>
    </Routes>
  );
}
