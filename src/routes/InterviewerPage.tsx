import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ClipboardList, PlayCircle, RefreshCw } from "lucide-react";
import { api } from "../api/client";
import EmptyState from "../components/EmptyState";
import type { InterviewSetting, InterviewSession } from "../../shared/types";

export default function InterviewerPage() {
  const [settings, setSettings] = useState<InterviewSetting[]>([]);
  const [sessions, setSessions] = useState<InterviewSession[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [busySettingId, setBusySettingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const activeSessions = useMemo(
    () => sessions.filter((session) => session.status !== "ended"),
    [sessions],
  );

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    setIsLoading(true);
    setError(null);
    try {
      const [nextSettings, nextSessions] = await Promise.all([api.listSettings(), api.listSessions()]);
      setSettings(nextSettings);
      setSessions(nextSessions);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load interviewer workspace");
    } finally {
      setIsLoading(false);
    }
  }

  async function createSession(settingId: string) {
    setBusySettingId(settingId);
    setError(null);
    try {
      const session = await api.createSession(settingId);
      navigate(`/interviewer/sessions/${session.id}`);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Unable to create session");
    } finally {
      setBusySettingId(null);
    }
  }

  return (
    <section className="page-stack">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Interviewer</p>
          <h1>Interview Settings</h1>
        </div>
        <button className="secondary-action" type="button" onClick={() => void load()}>
          <RefreshCw size={17} />
          Refresh
        </button>
      </div>

      {error && <div className="alert">{error}</div>}

      {isLoading ? (
        <div className="panel loading-line">Loading workspace...</div>
      ) : settings.length === 0 ? (
        <EmptyState
          icon={<ClipboardList size={24} />}
          title="No admin settings available"
          detail="Admin-created interview settings will appear here."
        />
      ) : (
        <div className="setting-grid">
          {settings.map((setting) => (
            <article className="setting-card" key={setting.id}>
              <div className="setting-card-top">
                <div>
                  <h2>{setting.smeName}</h2>
                  <p>{setting.jobRoleTitle}</p>
                </div>
                <span className="mini-pill">{setting.domainIndustry}</span>
              </div>
              <p className="clamped">{setting.interviewObjective}</p>
              <dl className="compact-meta">
                <div>
                  <dt>Interviewer</dt>
                  <dd>{setting.interviewerName}</dd>
                </div>
                <div>
                  <dt>Focus</dt>
                  <dd>{setting.keyFocusAreas}</dd>
                </div>
                <div>
                  <dt>ACTA</dt>
                  <dd>{setting.actaRatio}</dd>
                </div>
              </dl>
              <button
                className="primary-action"
                type="button"
                onClick={() => void createSession(setting.id)}
                disabled={busySettingId === setting.id}
              >
                <PlayCircle size={18} />
                {busySettingId === setting.id ? "Creating..." : "Conduct Interview"}
              </button>
            </article>
          ))}
        </div>
      )}

      <div className="panel">
        <div className="section-heading compact">
          <div>
            <p className="eyebrow">Sessions</p>
            <h1>Active Work</h1>
          </div>
          <span className="count-pill">{activeSessions.length}</span>
        </div>
        {activeSessions.length === 0 ? (
          <p className="muted-line">No active sessions.</p>
        ) : (
          <div className="session-list">
            {activeSessions.map((session) => (
              <Link className="session-row" to={`/interviewer/sessions/${session.id}`} key={session.id}>
                <span>
                  <strong>{session.settingSnapshot.smeName}</strong>
                  <small>{session.settingSnapshot.jobRoleTitle}</small>
                </span>
                <span className="status-pill">{session.status.replaceAll("_", " ")}</span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
