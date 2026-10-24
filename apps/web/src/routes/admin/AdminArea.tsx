import { Route, Routes } from "react-router";
import { AdminShell } from "../../app/AdminShell";
import { Overview } from "./Overview";
import { Flags } from "./Flags";
import { Reviews } from "./Reviews";
import { Certificates } from "./Certificates";
import { Placeholder } from "../Placeholder";

/**
 * The admin area, in its own lazily-loaded chunk so a learner's browser never
 * downloads admin screens (design.md §4.3).
 *
 * Overview, Flagged AI feedback, Project reviews and Certificates are built. The other seven
 * are specified in design.md §6 and tracked in docs/task-tracker.md; each
 * renders a placeholder naming what belongs there, so the sidebar is walkable.
 */
export default function AdminArea() {
  return (
    <Routes>
      <Route element={<AdminShell />}>
        <Route index element={<Overview />} />
        <Route path="paths" element={<Placeholder title="Career paths" section="section 6.2" />} />
        <Route path="modules" element={<Placeholder title="Modules" section="section 6.3" />} />
        <Route path="briefs" element={<Placeholder title="Capstone projects" section="section 6.5" />} />
        <Route path="reviews" element={<Reviews />} />
        <Route path="flags" element={<Flags />} />
        <Route path="analytics" element={<Placeholder title="Analytics" section="section 6.9" />} />
        <Route path="certificates" element={<Certificates />} />
        <Route path="users" element={<Placeholder title="Users" section="section 6.10" />} />
        <Route path="settings" element={<Placeholder title="Settings" section="section 6.11" />} />
        <Route path="log" element={<Placeholder title="Activity log" section="section 6.12" />} />
      </Route>
    </Routes>
  );
}
