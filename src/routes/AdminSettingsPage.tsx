import { FormEvent, useEffect, useMemo, useState } from "react";
import { FilePlus2, Pencil, Save, Trash2, X } from "lucide-react";
import { api } from "../api/client";
import EmptyState from "../components/EmptyState";
import type { Account, InterviewSetting, InterviewSettingInput } from "../../shared/types";
import { interviewSettingInputSchema } from "../../shared/validation";

const emptyInput: InterviewSettingInput = {
  interviewerName: "",
  smeName: "",
  jobRoleTitle: "",
  domainIndustry: "",
  jobDescription: "",
  interviewObjective: "",
  keyFocusAreas: "",
  actaRatio: "L1: 20%; L2: 60%; L3: 20%",
  assignedInterviewerAccountId: null,
};

type SettingFieldKey = Exclude<keyof InterviewSettingInput, "assignedInterviewerAccountId">;

const fields: Array<{
  key: SettingFieldKey;
  label: string;
  hint: string;
  multiline?: boolean;
}> = [
  {
    key: "interviewerName",
    label: "Interviewer Name",
    hint: "Input the full name of the interviewer",
  },
  {
    key: "smeName",
    label: "Subject Matter Expert (SME) Name",
    hint: "Input the full name of the SME",
  },
  {
    key: "jobRoleTitle",
    label: "Job Role / Title",
    hint: "Indicate the exact job title of the SME",
  },
  {
    key: "domainIndustry",
    label: "Domain / Industry",
    hint: "Indicate Domain/ Industry: [e.g., Industrial Power & Energy, Healthcare, Finance]",
  },
  {
    key: "jobDescription",
    label: "Job Description",
    hint: "Describe the SME's roles and key responsibilities.",
    multiline: true,
  },
  {
    key: "interviewObjective",
    label: "Interview Objective and Purpose",
    hint: "Describe the overall purpose of the interview and how the insights will be used.",
    multiline: true,
  },
  {
    key: "keyFocusAreas",
    label: "Key Focus Areas",
    hint: "Describe the specific areas of expertise, processes, decisions, challenges, or knowledge to explore.",
    multiline: true,
  },
  {
    key: "actaRatio",
    label: "Desired Applied Cognitive Task Analysis (ACTA) Ratio",
    hint: "Suggestion - L1: 20%; L2: 60%; L3: 20%",
    multiline: true,
  },
];

export default function AdminSettingsPage() {
  const [settings, setSettings] = useState<InterviewSetting[]>([]);
  const [interviewers, setInterviewers] = useState<Account[]>([]);
  const [form, setForm] = useState<InterviewSettingInput>(emptyInput);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const validation = useMemo(() => interviewSettingInputSchema.safeParse(form), [form]);

  useEffect(() => {
    void loadSettings();
  }, []);

  async function loadSettings() {
    setIsLoading(true);
    setError(null);
    try {
      const [nextSettings, nextInterviewers] = await Promise.all([
        api.listSettings(),
        api.listInterviewers(),
      ]);
      setSettings(nextSettings);
      setInterviewers(nextInterviewers);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load settings");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!validation.success) {
      setError(validation.error.issues[0]?.message ?? "All fields are required");
      return;
    }

    setIsSaving(true);
    setError(null);
    try {
      if (editingId) {
        await api.updateSetting(editingId, form);
      } else {
        await api.createSetting(form);
      }
      setForm(emptyInput);
      setEditingId(null);
      await loadSettings();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save setting");
    } finally {
      setIsSaving(false);
    }
  }

  function startEditing(setting: InterviewSetting) {
    setEditingId(setting.id);
    setForm({
      interviewerName: setting.interviewerName,
      smeName: setting.smeName,
      jobRoleTitle: setting.jobRoleTitle,
      domainIndustry: setting.domainIndustry,
      jobDescription: setting.jobDescription,
      interviewObjective: setting.interviewObjective,
      keyFocusAreas: setting.keyFocusAreas,
      actaRatio: setting.actaRatio,
      assignedInterviewerAccountId: setting.assignedInterviewerAccountId ?? null,
    });
  }

  async function assignAccess(settingId: string, interviewerAccountId: string | null) {
    setError(null);
    try {
      await api.updateSettingAccess(settingId, interviewerAccountId);
      await loadSettings();
    } catch (accessError) {
      setError(accessError instanceof Error ? accessError.message : "Unable to update access");
    }
  }

  function interviewerName(id: string | null | undefined): string {
    return interviewers.find((interviewer) => interviewer.id === id)?.displayName ?? "Unassigned";
  }

  async function removeSetting(setting: InterviewSetting) {
    const confirmed = window.confirm(`Delete interview setting for ${setting.smeName}?`);
    if (!confirmed) {
      return;
    }

    setError(null);
    try {
      await api.deleteSetting(setting.id);
      if (editingId === setting.id) {
        setEditingId(null);
        setForm(emptyInput);
      }
      await loadSettings();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Unable to delete setting");
    }
  }

  return (
    <section className="page-grid admin-grid">
      <div className="panel settings-form-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Admin</p>
            <h1>{editingId ? "Edit Interview Setting" : "Create Interview Setting"}</h1>
          </div>
          {editingId && (
            <button
              className="icon-button"
              type="button"
              title="Cancel edit"
              onClick={() => {
                setEditingId(null);
                setForm(emptyInput);
              }}
            >
              <X size={18} />
            </button>
          )}
        </div>

        <form className="settings-form" onSubmit={handleSubmit}>
          {fields.map((field) => (
            <label className="field" key={field.key}>
              <span>{field.label}</span>
              <small>{field.hint}</small>
              {field.multiline ? (
                <textarea
                  value={form[field.key]}
                  onChange={(event) => setForm((current) => ({ ...current, [field.key]: event.target.value }))}
                  placeholder="Field's value"
                  rows={field.key === "actaRatio" ? 3 : 4}
                />
              ) : (
                <input
                  value={form[field.key]}
                  onChange={(event) => setForm((current) => ({ ...current, [field.key]: event.target.value }))}
                  placeholder="Field's value"
                />
              )}
            </label>
          ))}

          <label className="field">
            <span>Interviewer Access</span>
            <small>Only the selected interviewer can view and conduct this setting.</small>
            <select
              value={form.assignedInterviewerAccountId ?? ""}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  assignedInterviewerAccountId: event.target.value || null,
                }))
              }
            >
              <option value="">Unassigned</option>
              {interviewers.map((interviewer) => (
                <option value={interviewer.id} key={interviewer.id}>
                  {interviewer.displayName} ({interviewer.username})
                </option>
              ))}
            </select>
          </label>

          {error && <div className="alert">{error}</div>}

          <button className="primary-action" type="submit" disabled={!validation.success || isSaving}>
            <Save size={18} />
            {isSaving ? "Saving..." : editingId ? "Save Changes" : "Create Setting"}
          </button>
        </form>
      </div>

      <div className="panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Settings</p>
            <h1>Interview Library</h1>
          </div>
          <span className="count-pill">{settings.length}</span>
        </div>

        {isLoading ? (
          <div className="loading-line">Loading settings...</div>
        ) : settings.length === 0 ? (
          <EmptyState
            icon={<FilePlus2 size={24} />}
            title="No settings yet"
            detail="Create an interview setting to make it available to interviewers."
          />
        ) : (
          <div className="setting-list">
            {settings.map((setting) => (
              <article className="setting-card" key={setting.id}>
                <div>
                  <h2>{setting.smeName}</h2>
                  <p>{setting.jobRoleTitle}</p>
                </div>
                <dl className="compact-meta">
                  <div>
                    <dt>Interviewer</dt>
                    <dd>{setting.interviewerName}</dd>
                  </div>
                  <div>
                    <dt>Access</dt>
                    <dd>{interviewerName(setting.assignedInterviewerAccountId)}</dd>
                  </div>
                  <div>
                    <dt>Domain</dt>
                    <dd>{setting.domainIndustry}</dd>
                  </div>
                  <div>
                    <dt>ACTA</dt>
                    <dd>{setting.actaRatio}</dd>
                  </div>
                </dl>
                <label className="field compact-access-field">
                  <span>Update Access</span>
                  <select
                    value={setting.assignedInterviewerAccountId ?? ""}
                    onChange={(event) =>
                      void assignAccess(setting.id, event.target.value || null)
                    }
                  >
                    <option value="">Unassigned</option>
                    {interviewers.map((interviewer) => (
                      <option value={interviewer.id} key={interviewer.id}>
                        {interviewer.displayName} ({interviewer.username})
                      </option>
                    ))}
                  </select>
                </label>
                <div className="button-row">
                  <button className="secondary-action" type="button" onClick={() => startEditing(setting)}>
                    <Pencil size={17} />
                    Edit
                  </button>
                  <button className="danger-action" type="button" onClick={() => void removeSetting(setting)}>
                    <Trash2 size={17} />
                    Delete
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
