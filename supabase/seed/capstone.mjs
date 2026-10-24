/**
 * Capstone briefs (`design.md` §5.14, `database-schema.md` §7).
 *
 * One brief per track, each with a published version, a starter template per
 * technology, and milestones carrying acceptance criteria, a review checklist
 * for the Code Review AI, and automatic checks.
 *
 * ### The repository names are placeholders until the templates exist
 *
 * `starterTemplates` names real GitHub repositories the learner copies. They do
 * not exist yet — **change the owner to the account or organisation that will
 * hold them before running the seed against anything a learner can reach.**
 * The seed validates shape, not existence; a wrong name here is a dead button
 * on §5.14 stage 2 and nothing else will notice.
 *
 * ### Why the checks lean on the test workflow
 *
 * `milestone_checks` belong to a brief **version**, and a version has a starter
 * template for *each* technology — one set of checks has to pass for a React
 * learner and a Vue learner alike. A `workflow_test` check names a test that
 * the starter template itself defines, so both templates can ship the same test
 * names over completely different code, and §5.14's own mockup shows exactly
 * that ("✕ Test: rejects empty input").
 *
 * `file_exists` is used sparingly and its `path` is treated as a **glob**, so
 * `src/components/TaskForm.*` matches `.jsx` and `.vue` without the check
 * needing to know which framework it is looking at.
 *
 * ### Related modules list both technologies
 *
 * `milestone_modules` names the React *and* Vue variants of a skill. The API
 * filters them to the technology the learner actually chose before §5.14 draws
 * "Related modules", because a React learner has no business being sent to a
 * Vue module.
 */

export const capstones = [
  {
    slug: "task-tracker",
    /** Matches `tracks.title` in junior-web-developer.mjs. */
    track: "Frontend",
    version: {
      title: "Task tracker",
      description:
        "A small app for keeping a list of things to do: add them, change them, tick them off, and find them again tomorrow. Everything you have learned on the Frontend track is in here, and nothing that is not.",
      goals:
        "Build and deploy a working app from an empty repository, in small steps you push as you go. By the end you have a live link, a commit history that shows how it was built, and something concrete to talk about in an interview.",
      estimatedWeeks: 3,
    },

    /**
     * One per technology offered on this track. A learner who chose React is
     * sent to the React one and never sees the other.
     */
    starterTemplates: {
      react: "first-commit/task-tracker-react",
      vue: "first-commit/task-tracker-vue",
    },

    milestones: [
      {
        title: "Set up the repository",
        modules: ["git-basics", "git-branching"],
        acceptanceCriteria: [
          "Your repository is made from the starter template and is connected here",
          "You have pushed at least one commit of your own",
          "The README says, in your own words, what you are building",
        ],
        /**
         * Read by the Code Review AI, never by the learner (§6 rule 2 puts
         * rubrics and checklists admin-side). These are the judgments a check
         * cannot make.
         */
        reviewChecklist: [
          "The README describes the project in the learner's own words rather than the template's",
          "The commit message says what changed, not just 'update'",
        ],
        explanationQuestion: null,
        checks: [
          {
            type: "file_exists",
            name: "README.md is present",
            config: { path: "README.md" },
          },
          {
            type: "file_exists",
            name: "The test workflow came across from the template",
            config: { path: ".github/workflows/*.yml" },
          },
        ],
      },

      {
        title: "Build the layout",
        modules: [
          "html-basics",
          "forms-and-semantics",
          "css-basics",
          "css-layout",
          "what-are-components",
          "components-in-react",
          "components-in-vue",
        ],
        acceptanceCriteria: [
          "The page has a heading, a place to add a task, and a place the list will go",
          "The form uses a real <form> with a labelled input",
          "The layout still works at 320px wide without sideways scrolling",
        ],
        reviewChecklist: [
          "The markup uses elements that mean something rather than a page of divs",
          "The input has a label a screen reader can announce, not a placeholder standing in for one",
          "The layout is split into components rather than written as one file",
        ],
        explanationQuestion: null,
        checks: [
          {
            type: "file_exists",
            name: "A task form component exists",
            config: { path: "src/components/TaskForm.*" },
          },
          {
            type: "workflow_test",
            name: "Test: the page renders its heading and form",
            config: { workflow: "test.yml", test_name: "renders the app shell" },
          },
        ],
      },

      {
        title: "Add and edit tasks",
        modules: [
          "js-basics",
          "js-functions",
          "js-arrays-objects",
          "state-and-props-react",
          "state-and-props-vue",
        ],
        acceptanceCriteria: [
          "Typing a task and submitting adds it to the list",
          "An existing task can be changed without adding a second one",
          "Submitting an empty input adds nothing and says why",
        ],
        reviewChecklist: [
          "Adding a task creates a new list rather than changing the old one in place",
          "Each task is identified by something stable, not by its position in the list",
          "The empty-input case is handled in one place rather than checked twice",
        ],
        /**
         * §5.14: "In a few sentences, explain how your submit handler prevents
         * empty tasks." The answer is stored and read by an admin only if the
         * project is flagged — it is not graded.
         */
        explanationQuestion:
          "In a few sentences, explain how your form stops an empty task being added, and what the person sees when they try.",
        checks: [
          {
            type: "workflow_test",
            name: "Test: adds a task",
            config: { workflow: "test.yml", test_name: "adds a task" },
          },
          {
            type: "workflow_test",
            name: "Test: edits a task",
            config: { workflow: "test.yml", test_name: "edits a task" },
          },
          {
            type: "workflow_test",
            name: "Test: rejects empty input",
            config: { workflow: "test.yml", test_name: "rejects empty input" },
          },
        ],
      },

      {
        title: "Save tasks",
        modules: ["js-dom", "js-arrays-objects"],
        acceptanceCriteria: [
          "Tasks are still there after the page is reloaded",
          "A task that is deleted stays deleted after a reload",
          "The app still starts when there is nothing saved yet",
        ],
        reviewChecklist: [
          "Reading what was saved copes with it being missing or unreadable, rather than assuming it is there",
          "Saving happens when the list changes, not on a timer",
        ],
        explanationQuestion: null,
        checks: [
          {
            type: "workflow_test",
            name: "Test: tasks survive a reload",
            config: { workflow: "test.yml", test_name: "keeps tasks after a reload" },
          },
          {
            type: "workflow_test",
            name: "Test: starts with nothing saved",
            config: { workflow: "test.yml", test_name: "starts with an empty store" },
          },
        ],
      },

      {
        title: "Deploy",
        modules: ["git-branching"],
        acceptanceCriteria: [
          "The app is live at a public address anyone can open",
          "The README links to it",
          "The live version is the one in your repository, not an older build",
        ],
        reviewChecklist: [
          "The live app does what the milestones above claim it does",
          "The README tells someone how to run it themselves",
        ],
        explanationQuestion: null,
        /**
         * §5.14: "Milestone 5 (Deploy) asks for the live demo link, which is
         * checked to confirm it loads." The learner supplies the address; the
         * check is that it answers, and `capstone_projects.demo_url` holds it.
         */
        checks: [
          {
            type: "deployment_url",
            name: "The live address answers",
            config: {},
          },
        ],
      },
    ],
  },
];
