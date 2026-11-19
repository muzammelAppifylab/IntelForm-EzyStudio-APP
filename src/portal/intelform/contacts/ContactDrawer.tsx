import {useQuery} from '@tanstack/react-query';
import {Link} from '@tanstack/react-router';
import type {ReactNode} from 'react';

import type {ContactDetailResponse} from '../../../lib/intelform/api-contacts';
import {ago, when} from '../../shared';
import {Avatar, Button, Drawer, ErrorNote, Icon, LoadingBlock, StatCard} from '../../ui';
import {contactDetailQuery} from '../queries/contacts';
import {CopyButton, FormStatus} from './bits';
import {contactTitle, countryLabel, deviceLabel, formatDate, formatDuration, formatNumber, formatPhone, formResponses} from './format';

/** One contact: details, the forms they answered and their responses, newest first. */
export function ContactDrawer({
  contactKey,
  onClose,
  onDelete,
  onExport,
  exporting,
}: {
  contactKey: string | null;
  onClose: () => void;
  onDelete: ((detail: ContactDetailResponse) => void) | null;
  /** Starts the CSV export of these contacts (a background job). */
  onExport: (keys: string[]) => void;
  exporting: boolean;
}) {
  const open = !!contactKey;
  const query = useQuery({...contactDetailQuery(contactKey ?? ''), enabled: open});
  const detail = query.data && query.data.contact.key === contactKey ? query.data : undefined;
  const c = detail?.contact;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={c ? contactTitle(c) : 'Contact'}
      description={c ? `Contact since ${formatDate(c.firstSeen)}` : undefined}
      footer={
        detail && c ? (
          <>
            {onDelete && (
              <Button variant="danger" icon="trash" onClick={() => onDelete(detail)}>
                Delete contact
              </Button>
            )}
            <Button variant="secondary" icon="download" pending={exporting} pendingLabel="Exporting…" onClick={() => onExport([c.key])}>
              Export CSV
            </Button>
          </>
        ) : undefined
      }>
      {query.error && !detail ? (
        <div className="contacts-drawer-error">
          <ErrorNote error={query.error} title="This contact didn’t load" />
          <Button variant="secondary" onClick={() => void query.refetch()}>
            Try again
          </Button>
        </div>
      ) : !detail || !c ? (
        <LoadingBlock rows={5} />
      ) : (
        <div className="contacts-detail">
          <div className="contacts-detail-head">
            <Avatar name={contactTitle(c)} size="lg" />
            <div>
              <p className="contacts-detail-name">{contactTitle(c)}</p>
              <p className="muted">Last active {ago(c.lastSeen)}</p>
            </div>
          </div>

          <dl className="contacts-rows">
            <DetailRow label="Email" copy={c.email ? {value: c.email, label: 'Copy email', done: 'Email copied.'} : undefined}>
              {c.email ? <a href={`mailto:${c.email}`}>{c.email}</a> : <span className="muted">No email</span>}
            </DetailRow>
            <DetailRow label="Phone" copy={c.phone ? {value: c.phone, label: 'Copy phone number', done: 'Phone number copied.'} : undefined}>
              {c.phone ? <a href={`tel:${c.phone}`}>{formatPhone(c.phone)}</a> : <span className="muted">No phone number</span>}
            </DetailRow>
            <DetailRow label="Country">{c.country ? countryLabel(c.country) : <span className="muted">–</span>}</DetailRow>
            <DetailRow label="First seen">
              <time dateTime={c.firstSeen}>{when(c.firstSeen)}</time>
            </DetailRow>
            <DetailRow label="Last active">
              <time dateTime={c.lastSeen} title={when(c.lastSeen)}>
                {ago(c.lastSeen)}
              </time>
            </DetailRow>
          </dl>

          <div className="contacts-pair">
            <StatCard label={c.responseCount === 1 ? 'Response' : 'Responses'} value={formatNumber(c.responseCount)} />
            <StatCard label={c.formCount === 1 ? 'Form' : 'Forms'} value={formatNumber(c.formCount)} />
          </div>

          <section aria-labelledby="contact-forms" className="contacts-section">
            <h3 id="contact-forms" className="contacts-overline">
              Forms answered
            </h3>
            <ul className="contacts-forms">
              {detail.forms.map(f => (
                <li key={f.id}>
                  <Link to="/forms/$formId/responses" params={{formId: f.id}} className="contacts-forms-title">
                    {f.title}
                  </Link>
                  <FormStatus status={f.status} />
                  <span className="contacts-forms-count">{formResponses(f.responses)}</span>
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="contact-timeline" className="contacts-section">
            <h3 id="contact-timeline" className="contacts-overline">
              Responses
            </h3>
            <ol className="contacts-timeline">
              {detail.responses.map(r => {
                const meta = [deviceLabel(r.device), r.durationMs !== null ? `took ${formatDuration(r.durationMs)}` : null].filter(Boolean).join(' · ');
                return (
                  <li key={r.id}>
                    <span className="contacts-timeline-dot" aria-hidden="true" />
                    <div className="contacts-timeline-body">
                      <Link
                        to="/forms/$formId/responses"
                        params={{formId: r.form.id}}
                        search={{response: r.id}}
                        className="contacts-timeline-link">
                        <span>{r.form.title}</span>
                        <Icon name="arrow-up-right" size={14} />
                        <span className="visually-hidden">, open this response</span>
                      </Link>
                      <p className="muted">
                        <time dateTime={r.submittedAt}>{when(r.submittedAt)}</time>
                        {meta && ` · ${meta}`}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ol>
            {detail.responses.length < c.responseCount && (
              <p className="muted">Showing the latest {formatNumber(detail.responses.length)}. Each form’s Responses tab has the rest.</p>
            )}
          </section>
        </div>
      )}
    </Drawer>
  );
}

function DetailRow({label, copy, children}: {label: string; copy?: {value: string; label: string; done: string}; children: ReactNode}) {
  return (
    <div className="contacts-row">
      <dt>{label}</dt>
      <dd>{children}</dd>
      <span className="contacts-row-copy">{copy && <CopyButton {...copy} />}</span>
    </div>
  );
}
