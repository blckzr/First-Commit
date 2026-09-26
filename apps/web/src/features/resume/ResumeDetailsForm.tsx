import { useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { z } from "zod";
import { Button } from "../../components/core/Button";
import { Input } from "../../components/forms/Input";
import { ApiError } from "../../api/client";
import { resumeApi, type Details } from "../../api/resume";
import styles from "./ResumeDetailsForm.module.css";

/**
 * §5.16's "Edit details" — contact details and education.
 *
 * **The only free text a learner puts on their own resume**, besides editing the
 * model's summary. Everything else comes from evidence. These are facts about
 * the person rather than claims the platform is vouching for, which is why they
 * are typed rather than earned — and why there is deliberately no "experience"
 * field here (§7: module completion is a skill, never experience).
 *
 * **First use of React Hook Form**, which `design.md` §13.1 specifies and
 * AGENT.md held back until something needed it. This is that something: a form
 * with two repeating groups, where hand-rolled state would be the wrong answer.
 * The same Zod schema shapes the fields and validates them, so the browser and
 * the API agree about what a link is.
 */

const Schema = z.object({
  email: z.union([z.literal(""), z.string().email("Enter a valid email address.")]),
  phone: z.string().max(40),
  city: z.string().max(120),
  links: z.array(
    z.object({
      label: z.string().trim().min(1, "Give the link a name."),
      url: z.string().trim().url("Enter a full web address, starting with https://"),
    }),
  ),
  education: z.array(
    z.object({
      school: z.string().trim().min(1, "Enter the school's name."),
      degree: z.string(),
      start: z.string(),
      end: z.string(),
    }),
  ),
});
type Values = z.infer<typeof Schema>;

export function ResumeDetailsForm({
  details,
  onSaved,
}: {
  details: Details;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(false);

  const form = useForm<Values>({
    resolver: zodResolver(Schema),
    defaultValues: {
      email: details.email,
      phone: details.phone,
      city: details.city,
      links: details.links,
      education: details.education.map((e) => ({
        school: e.school,
        degree: e.degree ?? "",
        start: e.start ?? "",
        end: e.end ?? "",
      })),
    },
  });

  const links = useFieldArray({ control: form.control, name: "links" });
  const education = useFieldArray({ control: form.control, name: "education" });

  const save = useMutation({
    mutationFn: (values: Values) => resumeApi.saveDetails(values),
    onSuccess: () => {
      setSaved(true);
      setOpen(false);
      onSaved();
    },
  });

  if (!open) {
    return (
      <div className={styles.closed}>
        <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
          Edit details
        </Button>
        {saved && (
          <p role="status" aria-live="polite" className={styles.saved}>
            Details saved.
          </p>
        )}
      </div>
    );
  }

  return (
    <form
      className={styles.form}
      onSubmit={form.handleSubmit((values) => save.mutate(values))}
      noValidate
    >
      <Input label="Email" type="email" {...form.register("email")} error={form.formState.errors.email?.message} />
      <Input label="Phone" {...form.register("phone")} error={form.formState.errors.phone?.message} />
      <Input label="City" {...form.register("city")} error={form.formState.errors.city?.message} />

      <fieldset className={styles.group}>
        <legend className={styles.legend}>Links</legend>
        {links.fields.map((field, i) => (
          <div key={field.id} className={styles.row}>
            <Input
              label="Label"
              {...form.register(`links.${i}.label`)}
              error={form.formState.errors.links?.[i]?.label?.message}
            />
            <Input
              label="Address"
              {...form.register(`links.${i}.url`)}
              error={form.formState.errors.links?.[i]?.url?.message}
            />
            <Button type="button" variant="ghost" size="sm" onClick={() => links.remove(i)}>
              Remove link
            </Button>
          </div>
        ))}
        {links.fields.length < 6 && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => links.append({ label: "", url: "" })}
          >
            Add a link
          </Button>
        )}
      </fieldset>

      <fieldset className={styles.group}>
        <legend className={styles.legend}>Education</legend>
        {education.fields.map((field, i) => (
          <div key={field.id} className={styles.row}>
            <Input
              label="School"
              {...form.register(`education.${i}.school`)}
              error={form.formState.errors.education?.[i]?.school?.message}
            />
            <Input label="Qualification" {...form.register(`education.${i}.degree`)} />
            <Input label="From" {...form.register(`education.${i}.start`)} />
            <Input label="To" {...form.register(`education.${i}.end`)} />
            <Button type="button" variant="ghost" size="sm" onClick={() => education.remove(i)}>
              Remove entry
            </Button>
          </div>
        ))}
        {education.fields.length < 4 && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() =>
              education.append({ school: "", degree: "", start: "", end: "" })
            }
          >
            Add education
          </Button>
        )}
      </fieldset>

      {save.isError && (
        <p role="alert" className={styles.error}>
          {save.error instanceof ApiError
            ? save.error.message
            : "That didn't save. Try again in a moment."}
        </p>
      )}

      <div className={styles.actions}>
        {/* §9: buttons say what happens. */}
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? "Saving…" : "Save details"}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
