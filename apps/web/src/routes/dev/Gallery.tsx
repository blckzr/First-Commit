import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Badge } from "../../components/core/Badge";
import { Button } from "../../components/core/Button";
import { Card } from "../../components/core/Card";
import { Icon } from "../../components/core/Icon";
import type { IconName } from "../../components/core/Icon";
import { IconButton } from "../../components/core/IconButton";
import { LinkButton } from "../../components/core/LinkButton";
import { Tag } from "../../components/core/Tag";
import { Checkbox } from "../../components/forms/Checkbox";
import { Input } from "../../components/forms/Input";
import { RadioOption } from "../../components/forms/RadioOption";
import { SearchField } from "../../components/forms/SearchField";
import { Select } from "../../components/forms/Select";
import { CodeBlock } from "../../components/learning/CodeBlock";
import { ProgressBar } from "../../components/learning/ProgressBar";
import { StepIndicator } from "../../components/navigation/StepIndicator";
import { AA_TEXT, AA_UI, contrastRatio, resolveToken } from "../../styles/contrast";
import styles from "./Gallery.module.css";

/**
 * Development-only component gallery.
 *
 * Mounted at /dev/components and only in development (see app/router.tsx), so
 * it never ships. Its job is to make the whole set reviewable in one place
 * instead of hunting it across screens, and to keep the contrast consequences
 * of a token change visible — the ratios below are measured live from the
 * resolved custom properties, not copied in.
 */

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>{title}</h2>
      {note && <p className={styles.sectionNote}>{note}</p>}
      {children}
    </section>
  );
}

function Specimen({ name, props, children }: { name: string; props?: string; children: ReactNode }) {
  return (
    <div className={styles.specimen}>
      <div className={styles.specimenHead}>
        <span className={styles.specimenName}>{name}</span>
        {props && <code className={styles.specimenProps}>{props}</code>}
      </div>
      {children}
    </div>
  );
}

const COLOR_GROUPS: { group: string; tokens: string[] }[] = [
  { group: "Lime — fills, and text only on ink", tokens: ["--lime-100", "--lime-200", "--lime-300", "--lime-400", "--lime-500", "--lime-600", "--lime-700", "--lime-800"] },
  { group: "Violet — the ground", tokens: ["--violet-50", "--violet-100", "--violet-200", "--violet-300", "--violet-400", "--violet-500", "--violet-600", "--violet-700"] },
  { group: "Ink", tokens: ["--ink-900", "--ink-800", "--ink-700", "--ink-600"] },
  { group: "Neutrals", tokens: ["--gray-0", "--gray-50", "--gray-100", "--gray-200", "--gray-300", "--gray-400", "--gray-500", "--gray-600", "--gray-700"] },
  { group: "Status — text values", tokens: ["--verified", "--error", "--notice", "--info", "--here", "--ai"] },
  { group: "Status — tints", tokens: ["--verified-tint", "--error-tint", "--notice-tint", "--here-tint", "--ai-tint"] },
  { group: "Control edges", tokens: ["--border-subtle", "--border-strong", "--border-control", "--border-accent"] },
];

const CONTRAST_PAIRS: { fg: string; bg: string; label: string; need: number }[] = [
  { fg: "--text-strong", bg: "--surface-card", label: "Headings on a card", need: AA_TEXT },
  { fg: "--text-body", bg: "--surface-card", label: "Body on a card", need: AA_TEXT },
  { fg: "--text-muted", bg: "--surface-page", label: "Muted on the page", need: AA_TEXT },
  { fg: "--text-accent", bg: "--surface-card", label: "Accent phrase on light", need: AA_TEXT },
  { fg: "--text-accent-on-dark", bg: "--ink-900", label: "Accent phrase on ink", need: AA_TEXT },
  { fg: "--lime-600", bg: "--surface-card", label: "Lime as text on light — why the rule exists", need: AA_TEXT },
  { fg: "--text-on-lime", bg: "--accent", label: "Button label on lime", need: AA_TEXT },
  { fg: "--verified", bg: "--verified-tint", label: "Verified badge", need: AA_TEXT },
  { fg: "--error", bg: "--error-tint", label: "Error badge", need: AA_TEXT },
  { fg: "--notice", bg: "--notice-tint", label: "Notice badge", need: AA_TEXT },
  { fg: "--here", bg: "--here-tint", label: "Current badge", need: AA_TEXT },
  { fg: "--ai", bg: "--ai-tint", label: "AI badge", need: AA_TEXT },
  { fg: "--focus-ring", bg: "--surface-card", label: "Focus ring", need: AA_UI },
  { fg: "--border-control", bg: "--surface-card", label: "Control edge on a card", need: AA_UI },
  { fg: "--border-control", bg: "--surface-page", label: "Control edge on the page", need: AA_UI },
  { fg: "--border-accent", bg: "--surface-page", label: "Lime button edge on the page", need: AA_UI },
  { fg: "--border-strong", bg: "--surface-card", label: "Decorative rule — not a control edge", need: AA_UI },
];

const TYPE_SCALE = [
  "--text-display-1", "--text-display-2", "--text-display-3",
  "--text-h1", "--text-h2", "--text-h3", "--text-h4",
  "--text-body-lg", "--text-body-base", "--text-body-sm",
  "--text-caption", "--text-micro",
];

const RADII = ["--radius-xs", "--radius-sm", "--radius-md", "--radius-lg", "--radius-xl", "--radius-2xl", "--radius-pill"];
const SHADOWS = ["--shadow-xs", "--shadow-sm", "--shadow-md", "--shadow-lg", "--shadow-lime", "--glow-lime"];

const ICONS: IconName[] = [
  "arrow-left", "arrow-right", "award", "bell", "check", "chevron-down",
  "circle", "circle-dot", "code-xml", "copy", "external-link", "flag",
  "info", "lock", "log-out", "search", "settings", "user", "wrench", "x",
];

const BUTTON_VARIANTS = ["primary", "secondary", "dark", "outline", "ghost", "destructive"] as const;
const BADGE_TONES = ["lime", "dark", "violet", "neutral", "verified", "error", "notice", "here", "ai"] as const;

export function Gallery() {
  /**
   * Resolved once during render. Stylesheets are parsed before React mounts —
   * a <link> in production, injected by Vite in development — so the custom
   * properties are already available and no effect is needed.
   */
  const swatches = useMemo(
    () =>
      Object.fromEntries(
        COLOR_GROUPS.flatMap(({ tokens }) => tokens).map((t) => [t, resolveToken(t)]),
      ) as Record<string, string>,
    [],
  );

  const typeSizes = useMemo(
    () => Object.fromEntries(TYPE_SCALE.map((t) => [t, resolveToken(t)])) as Record<string, string>,
    [],
  );

  const contrastRows = useMemo(
    () =>
      CONTRAST_PAIRS.map((pair) => ({
        ...pair,
        ratio: contrastRatio(resolveToken(pair.fg), resolveToken(pair.bg)),
      })),
    [],
  );

  const [checked, setChecked] = useState(true);
  const [choice, setChoice] = useState("react");
  const [selectedTag, setSelectedTag] = useState("all");

  return (
    <div className={styles.page}>
      <div className={styles.container}>
        <header className={styles.header}>
          <h1 className={styles.title}>Component gallery</h1>
          <p className={styles.lede}>
            Every component in every variant, plus the tokens behind them. Development
            only — this route is not mounted in a production build.
          </p>
          <p className={styles.headerNote}>
            Hover, press, and focus are CSS state, so they do not appear in a static
            capture. Tab through this page to see the focus ring on each control.
          </p>
        </header>

        <Section
          title="Colour"
          note="Lime is a fill colour and an on-ink text colour. On light surfaces the accent phrase uses --text-accent (violet-700). Status colours come in pairs: a text value that passes 4.5:1, and a tint it sits on."
        >
          {COLOR_GROUPS.map(({ group, tokens }) => (
            <Specimen key={group} name={group}>
              <ul className={styles.swatchGrid}>
                {tokens.map((token) => (
                  <li key={token} className={styles.swatch}>
                    <div
                      className={styles.swatchChip}
                      style={{ background: `var(${token})` }}
                    />
                    <div className={styles.swatchMeta}>
                      <span className={styles.swatchName}>{token}</span>
                      <span className={styles.swatchHex}>{swatches[token]}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </Specimen>
          ))}
        </Section>

        <Section
          title="Contrast"
          note="Measured live from the resolved tokens, so changing a token shows its consequence here immediately. Targets come from design.md §12: 4.5:1 for text, 3:1 for UI components. Two rows fail on purpose and are kept as evidence, not defects: lime as text on a light surface is what the fill-only rule exists to prevent, and --border-strong is a decorative rule that no control depends on."
        >
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Pair</th>
                <th>Sample</th>
                <th className={styles.tableNum}>Ratio</th>
                <th className={styles.tableNum}>Needs</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {contrastRows.map(({ fg, bg, label, need, ratio }) => {
                const passes = ratio !== null && ratio >= need;
                return (
                  <tr key={`${fg}-${bg}`}>
                    <td>{label}</td>
                    <td>
                      <span
                        className={styles.sample}
                        style={{ color: `var(${fg})`, background: `var(${bg})` }}
                      >
                        Sample
                      </span>
                    </td>
                    <td className={styles.tableNum}>
                      {ratio === null ? "—" : `${ratio.toFixed(2)}:1`}
                    </td>
                    <td className={styles.tableNum}>{need.toFixed(1)}</td>
                    <td>
                      {ratio === null ? (
                        "—"
                      ) : passes ? (
                        <Badge tone="verified" icon="check">Passes</Badge>
                      ) : (
                        <Badge tone="error" icon="x">Fails</Badge>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Section>

        <Section title="Type" note="Plus Jakarta Sans throughout; JetBrains Mono for machine values.">
          {TYPE_SCALE.map((token) => (
            <div key={token} className={styles.typeRow}>
              <span className={styles.typeToken}>
                {token} · {typeSizes[token]}
              </span>
              <span
                className={styles.typeSample}
                style={{
                  fontSize: `var(${token})`,
                  fontFamily: token.includes("display") || token.includes("h") ? "var(--font-display)" : "var(--font-body)",
                  fontWeight: token.includes("display") ? "var(--fw-extrabold)" : "var(--fw-regular)",
                  letterSpacing: token.includes("display") ? "var(--ls-display)" : "var(--ls-body)",
                }}
              >
                From your first line of code
              </span>
            </div>
          ))}
        </Section>

        <Section title="Shape and elevation" note="Radii nest: 14 inside 20 inside 28. Cards are flat at rest; depth is reserved for interaction.">
          <Specimen name="Radii">
            <ul className={styles.boxGrid}>
              {RADII.map((token) => (
                <li key={token} className={styles.box} style={{ borderRadius: `var(${token})` }}>
                  {token.replace("--radius-", "")}
                </li>
              ))}
            </ul>
          </Specimen>
          <Specimen name="Elevation">
            <ul className={styles.boxGrid}>
              {SHADOWS.map((token) => (
                <li
                  key={token}
                  className={`${styles.box} ${styles.shadowBox}`}
                  style={{ boxShadow: `var(${token})`, borderRadius: "var(--radius-card)" }}
                >
                  {token.replace("--shadow-", "").replace("--glow-", "glow ")}
                </li>
              ))}
            </ul>
          </Specimen>
        </Section>

        <Section title="Core" note="Buttons, links, badges, cards, tags, icons.">
          <Specimen name="Button" props="variant × size">
            <div className={styles.stack}>
              {(["sm", "md", "lg"] as const).map((size) => (
                <div key={size} className={styles.row}>
                  {BUTTON_VARIANTS.map((variant) => (
                    <Button key={variant} variant={variant} size={size}>
                      {variant}
                    </Button>
                  ))}
                </div>
              ))}
            </div>
          </Specimen>

          <Specimen name="Button" props="icon · loading · disabled · fullWidth">
            <div className={styles.row}>
              <Button icon="arrow-right">Continue lesson</Button>
              <Button icon="arrow-left" iconPosition="left" variant="outline">Back</Button>
              <Button loading loadingLabel="Running tests…">Run tests</Button>
              <Button disabled>Create account</Button>
            </div>
            <div className={styles.col} style={{ marginTop: "var(--space-4)" }}>
              <Button fullWidth>Full width</Button>
            </div>
          </Specimen>

          <Specimen name="LinkButton" props="renders an <a>, shares Button styles">
            <div className={styles.row}>
              <LinkButton to="/">Go to landing</LinkButton>
              <LinkButton to="/signup" variant="outline" icon="arrow-right">Sign up</LinkButton>
            </div>
          </Specimen>

          <Specimen name="IconButton" props="variant × size · label required">
            <div className={styles.row}>
              {(["soft", "lime", "dark", "bare"] as const).map((variant) => (
                <IconButton key={variant} icon="bell" label={`Notifications (${variant})`} variant={variant} />
              ))}
              {(["sm", "md", "lg"] as const).map((size) => (
                <IconButton key={size} icon="settings" label={`Settings (${size})`} size={size} />
              ))}
            </div>
          </Specimen>

          <Specimen name="Badge" props="tone · icon · uppercase">
            <div className={styles.row}>
              {BADGE_TONES.map((tone) => (
                <Badge key={tone} tone={tone} icon="check">{tone}</Badge>
              ))}
              <Badge tone="neutral" uppercase>beginner · css</Badge>
            </div>
            <div className={`${styles.onInk} ${styles.row}`} style={{ marginTop: "var(--space-4)" }}>
              <Badge tone="onDark" icon="info">On an ink panel</Badge>
              <Badge tone="lime">Lime on ink</Badge>
            </div>
          </Specimen>

          <Specimen name="Card" props="surface · padding · border · hoverLift">
            <div className={styles.row}>
              {(["white", "soft", "inset", "lime"] as const).map((surface) => (
                <Card key={surface} surface={surface} border hoverLift style={{ width: 170 }}>
                  <strong>{surface}</strong>
                  <p style={{ fontSize: "var(--text-body-sm)", marginTop: 6 }}>hoverLift on</p>
                </Card>
              ))}
              <Card surface="dark" style={{ width: 170 }}>
                <strong style={{ color: "var(--text-on-dark)" }}>dark</strong>
                <p style={{ fontSize: "var(--text-body-sm)", marginTop: 6 }}>muted text</p>
              </Card>
            </div>
          </Specimen>

          <Specimen name="Tag" props="selected inverts to ink">
            <div className={styles.row}>
              {["all", "html", "css", "javascript"].map((tag) => (
                <Tag key={tag} selected={selectedTag === tag} onClick={() => setSelectedTag(tag)}>
                  {tag}
                </Tag>
              ))}
            </div>
          </Specimen>

          <Specimen name="Icon" props="20 glyphs in use">
            <ul className={styles.iconGrid}>
              {ICONS.map((name) => (
                <li key={name} className={styles.iconCell}>
                  <Icon name={name} size={22} />
                  {name}
                </li>
              ))}
            </ul>
          </Specimen>
        </Section>

        <Section title="Forms" note="Inputs are never pills — that shape is reserved for actions. The search field is the one exception.">
          <Specimen name="Input" props="label · hint · error · icon · size">
            <div className={styles.col}>
              <Input label="Full name" placeholder="Jan Kevin" />
              <Input label="Email" type="email" hint="We'll only use this to sign you in." />
              <Input label="Weekly hours" error="Enter weekly hours as a number between 1 and 40." defaultValue="99" />
              <Input label="Certificate ID" icon="award" placeholder="FC-0000-0000" />
              <Input label="Small" size="sm" placeholder="size='sm'" />
            </div>
          </Specimen>

          <Specimen name="Select">
            <div className={styles.col}>
              <Select
                label="Track"
                options={[
                  { value: "frontend", label: "Frontend" },
                  { value: "backend", label: "Backend" },
                  { value: "fullstack", label: "Full-stack" },
                ]}
              />
            </div>
          </Specimen>

          <Specimen name="Checkbox" props="a real input, styled through CSS siblings">
            <div className={styles.stack}>
              <Checkbox label="I agree to the Privacy Notice and Terms of Use" checked={checked} onChange={(e) => setChecked(e.currentTarget.checked)} />
              <Checkbox label="Unchecked" defaultChecked={false} />
              <Checkbox label="Disabled" disabled />
            </div>
          </Specimen>

          <Specimen name="RadioOption" props="group inside a fieldset with a legend">
            <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
              <legend style={{ fontSize: "var(--text-body-sm)", fontWeight: "var(--fw-semibold)", marginBottom: "var(--space-2)" }}>
                Choose your framework
              </legend>
              <div className={styles.stack}>
                {[
                  { id: "react", label: "React — recommended" },
                  { id: "vue", label: "Vue" },
                ].map((o) => (
                  <RadioOption
                    key={o.id}
                    name="framework"
                    label={o.label}
                    checked={choice === o.id}
                    onChange={() => setChoice(o.id)}
                  />
                ))}
              </div>
            </fieldset>
          </Specimen>

          <Specimen name="SearchField" props="label is visually hidden">
            <SearchField label="Search modules" placeholder="Search modules…" />
          </Specimen>
        </Section>

        <Section title="Learning" note="Domain components. The progress bar is always paired with text.">
          <Specimen name="ProgressBar" props="value · label · showValue · onDark">
            <div className={styles.col} style={{ maxWidth: 520 }}>
              <ProgressBar value={37.5} label="6 of 16 modules passed" showValue />
              <ProgressBar value={100} label="All modules passed" showValue />
              <ProgressBar value={0} label="Not started" />
            </div>
            <div className={styles.onInk} style={{ marginTop: "var(--space-4)", maxWidth: 520 }}>
              <ProgressBar value={62} label="Capstone milestones" showValue onDark />
            </div>
          </Specimen>

          <Specimen name="CodeBlock" props="lines with syntax tones">
            <div style={{ maxWidth: 520 }}>
              <CodeBlock
                filename="script.js"
                language="javascript"
                lines={[
                  { text: "function sumEven(nums) {", tone: "key" },
                  { text: "  let total = 0;" },
                  { text: "  // the loop starts at 1 — the first item is skipped", tone: "com" },
                  { text: "  for (let i = 1; i < nums.length; i++) {", tone: "tag" },
                  { text: '    if (nums[i] % 2 === 0) total += nums[i];', tone: "str" },
                  { text: "  }" },
                  { text: "  return total;" },
                  { text: "}" },
                ]}
              />
            </div>
          </Specimen>
        </Section>

        <Section title="Navigation" note="Used only for true sequences.">
          <Specimen name="StepIndicator" props="steps · current">
            <div className={styles.stack}>
              <StepIndicator steps={["About you", "Target", "Placement", "Your roadmap"]} current={1} />
              <StepIndicator steps={["Set up", "Build", "Deploy"]} current={2} />
            </div>
          </Specimen>
        </Section>
      </div>
    </div>
  );
}
