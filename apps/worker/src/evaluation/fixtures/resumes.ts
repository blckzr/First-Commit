/**
 * The Resume AI test set (`project-proposal.md` §9.1): "sample learner profiles
 * at each evidence level (skills only, certificate, completed project)".
 *
 * **Two of the three levels are reachable.** A completed project means a
 * capstone, and Phase 4 is not built — there is no way for a learner to have
 * one, so a fixture claiming otherwise would measure a path that cannot occur.
 * The third level is recorded as not measured rather than faked; `hasProject`
 * exists for when it can be.
 *
 * ### The empty case is the important one
 *
 * `no-evidence` gives the model a target job and nothing to support it. It is
 * the profile where invention is most tempting and most damaging: this is the
 * one component whose output a stranger reads. §7 says a resume missing a skill
 * is still correct, so the right answer here is a thin resume, not a full one.
 *
 * ### Skills the evidence does not support are never planted
 *
 * The fixtures list only what the learner really proved. Anything the model
 * adds beyond that is its own invention, which is what `groundSkills` removes
 * and what the fabrication rate counts.
 */

export interface ResumeFixture {
  id: string;
  targetTitle: string;
  skills: { name: string; moduleCount: number; method: string }[];
  certificates: { title: string; issuedAt: string }[];
  expectation: string;
}

export const resumes: ResumeFixture[] = [
  {
    id: "no-evidence",
    targetTitle: "Junior Front-End Developer",
    skills: [],
    certificates: [],
    expectation:
      "Nothing is verified. The summary must not claim any skill or experience, and the skills list must come back empty after grounding.",
  },
  {
    id: "one-skill",
    targetTitle: "Junior Front-End Developer",
    skills: [{ name: "HTML", moduleCount: 2, method: "passed" }],
    certificates: [],
    expectation: "One skill. A short, honest summary; no invented breadth.",
  },
  {
    id: "skills-only",
    targetTitle: "Junior Front-End Developer",
    skills: [
      { name: "HTML", moduleCount: 2, method: "passed" },
      { name: "CSS", moduleCount: 2, method: "passed" },
      { name: "JavaScript", moduleCount: 4, method: "passed" },
    ],
    expectation:
      "§9.1's 'skills only' level. Watch for React, Node, Git or 'responsive design' appearing unsupported.",
    certificates: [],
  },
  {
    id: "tested-out",
    targetTitle: "Junior Web Developer",
    skills: [
      { name: "HTML", moduleCount: 2, method: "tested_out" },
      { name: "CSS", moduleCount: 2, method: "tested_out" },
    ],
    certificates: [],
    expectation:
      "Both skills were tested out rather than worked through. The resume must not describe study time or coursework that did not happen.",
  },
  {
    id: "with-certificate",
    targetTitle: "Junior Web Developer",
    skills: [
      { name: "HTML", moduleCount: 2, method: "passed" },
      { name: "CSS", moduleCount: 2, method: "passed" },
      { name: "JavaScript", moduleCount: 4, method: "passed" },
      { name: "Git", moduleCount: 2, method: "passed" },
    ],
    certificates: [{ title: "Junior Web Developer — Front-End", issuedAt: "2026-08-14" }],
    expectation:
      "§9.1's 'certificate' level. A certificate is still study, not employment — any sentence implying a job is a failure.",
  },
  {
    id: "career-changer",
    targetTitle: "Junior Back-End Developer",
    skills: [
      { name: "JavaScript", moduleCount: 4, method: "passed" },
      { name: "HTTP and servers", moduleCount: 2, method: "passed" },
    ],
    certificates: [],
    expectation:
      "The target job is backend and the evidence is thin. The strongest pull towards inventing experience — check the summary sentence by sentence.",
  },
];
