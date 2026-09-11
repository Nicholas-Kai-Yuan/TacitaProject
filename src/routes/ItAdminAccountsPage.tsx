import { FormEvent, useEffect, useState } from "react";
import { Pencil, Save, Trash2, UserPlus, X } from "lucide-react";
import { api } from "../api/client";
import EmptyState from "../components/EmptyState";
import type {
  Account,
  ManagedAccountInput,
  ManagedAccountRole,
  ManagedAccountUpdateInput,
} from "../../shared/types";
import { managedAccountInputSchema, managedAccountUpdateSchema } from "../../shared/validation";

interface AccountForm {
  username: string;
  displayName: string;
  password: string;
  role: ManagedAccountRole;
}

const emptyForm: AccountForm = {
  username: "",
  displayName: "",
  password: "",
  role: "interviewer",
};

export default function ItAdminAccountsPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [form, setForm] = useState<AccountForm>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadAccounts();
  }, []);

  async function loadAccounts() {
    setIsLoading(true);
    setError(null);
    try {
      setAccounts(await api.listAccounts());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load accounts");
    } finally {
      setIsLoading(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validation = editingId
      ? managedAccountUpdateSchema.safeParse(form)
      : managedAccountInputSchema.safeParse(form);

    if (!validation.success) {
      setError(validation.error.issues[0]?.message ?? "Account details are incomplete");
      return;
    }

    setIsSaving(true);
    setError(null);
    try {
      if (editingId) {
        const input: ManagedAccountUpdateInput = {
          username: form.username,
          displayName: form.displayName,
          role: form.role,
          password: form.password || undefined,
        };
        await api.updateAccount(editingId, input);
      } else {
        const input: ManagedAccountInput = {
          username: form.username,
          displayName: form.displayName,
          role: form.role,
          password: form.password,
        };
        await api.createAccount(input);
      }

      setForm(emptyForm);
      setEditingId(null);
      await loadAccounts();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save account");
    } finally {
      setIsSaving(false);
    }
  }

  function edit(account: Account) {
    if (account.role !== "admin" && account.role !== "interviewer") {
      return;
    }

    setEditingId(account.id);
    setForm({
      username: account.username,
      displayName: account.displayName,
      role: account.role,
      password: "",
    });
  }

  async function remove(account: Account) {
    const confirmed = window.confirm(`Delete ${account.displayName}'s account?`);
    if (!confirmed) {
      return;
    }

    setError(null);
    try {
      await api.deleteAccount(account.id);
      await loadAccounts();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Unable to delete account");
    }
  }

  return (
    <section className="page-grid admin-grid">
      <div className="panel settings-form-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">IT Admin</p>
            <h1>{editingId ? "Edit Account" : "Create Account"}</h1>
          </div>
          {editingId && (
            <button
              className="icon-button"
              type="button"
              title="Cancel edit"
              onClick={() => {
                setEditingId(null);
                setForm(emptyForm);
              }}
            >
              <X size={18} />
            </button>
          )}
        </div>

        <form className="settings-form" onSubmit={submit}>
          <label className="field">
            <span>Display Name</span>
            <input
              value={form.displayName}
              onChange={(event) => setForm((current) => ({ ...current, displayName: event.target.value }))}
              placeholder="Full name"
            />
          </label>
          <label className="field">
            <span>Username</span>
            <input
              value={form.username}
              onChange={(event) => setForm((current) => ({ ...current, username: event.target.value }))}
              placeholder="username"
              autoComplete="username"
            />
          </label>
          <label className="field">
            <span>Password</span>
            <input
              type="password"
              value={form.password}
              onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))}
              placeholder={editingId ? "Leave blank to keep current password" : "At least 6 characters"}
              autoComplete="new-password"
            />
          </label>
          <label className="field">
            <span>Role</span>
            <select
              value={form.role}
              onChange={(event) =>
                setForm((current) => ({ ...current, role: event.target.value as ManagedAccountRole }))
              }
            >
              <option value="interviewer">Interviewer</option>
              <option value="admin">Admin</option>
            </select>
          </label>

          {error && <div className="alert">{error}</div>}

          <button className="primary-action" type="submit" disabled={isSaving}>
            <Save size={18} />
            {isSaving ? "Saving..." : editingId ? "Save Changes" : "Create Account"}
          </button>
        </form>
      </div>

      <div className="panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Accounts</p>
            <h1>Admin & Interviewer Users</h1>
          </div>
          <span className="count-pill">{accounts.length}</span>
        </div>

        {isLoading ? (
          <div className="loading-line">Loading accounts...</div>
        ) : accounts.length === 0 ? (
          <EmptyState
            icon={<UserPlus size={24} />}
            title="No managed accounts"
            detail="Create admin and interviewer accounts for TACITA access."
          />
        ) : (
          <div className="setting-list">
            {accounts.map((account) => (
              <article className="setting-card" key={account.id}>
                <div className="setting-card-top">
                  <div>
                    <h2>{account.displayName}</h2>
                    <p>{account.username}</p>
                  </div>
                  <span className="status-pill">{account.role}</span>
                </div>
                <div className="button-row">
                  <button className="secondary-action" type="button" onClick={() => edit(account)}>
                    <Pencil size={17} />
                    Edit
                  </button>
                  <button className="danger-action" type="button" onClick={() => void remove(account)}>
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
