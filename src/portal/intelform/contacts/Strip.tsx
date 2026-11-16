import {Link} from '@tanstack/react-router';

import type {ContactsStrip} from '../../../lib/intelform/api-contacts';
import {FORM_STATUS_LABEL} from '../../../lib/intelform/api-forms';
import {Card, Icon, Skeleton, StatCard} from '../../ui';
import {formatNumber} from './format';

/**
 * The totals beside the forms that collected the most contacts. The numbers are the whole
 * workspace (they ignore the filters); picking a form filters the list to its contacts.
 */
export function Strip({strip, activeForms, onForm}: {strip: ContactsStrip | undefined; activeForms: string[]; onForm: (id: string) => void}) {
  return (
    <div className="contacts-strip">
      <div className="contacts-stats">
        <StatCard
          tone="chamber"
          icon="contact"
          label="Contacts, all forms"
          value={strip ? formatNumber(strip.total) : null}
          description="People who left an email or phone number in a response"
        />
        <StatCard label="New this week" icon="user-plus" value={strip ? formatNumber(strip.newThisWeek) : null} />
        <StatCard label="Returning" icon="refresh" value={strip ? formatNumber(strip.returning) : null} description="2 or more responses" />
        <StatCard label="With a phone number" icon="phone" value={strip ? `${Math.round(strip.withPhonePct)}%` : null} />
      </div>
      <Card
        title="Most contacts"
        description="Pick a form to see only its contacts"
        footer={
          <Link to="/forms" className="contacts-link">
            View all forms <Icon name="arrow-right" size={16} />
          </Link>
        }>
        {!strip ? (
          <Skeleton lines={3} />
        ) : strip.topForms.length === 0 ? (
          <p className="muted">No form has collected a contact yet.</p>
        ) : (
          <ol className="contacts-top">
            {strip.topForms.map((f, i) => {
              const active = activeForms.length === 1 && activeForms[0] === f.id;
              return (
                <li key={f.id}>
                  <button type="button" className="contacts-top-item" aria-pressed={active} onClick={() => onForm(f.id)}>
                    <span className="contacts-top-rank" aria-hidden="true">
                      {i + 1}
                    </span>
                    <span className="contacts-top-text">
                      <span className="contacts-top-title">{f.title}</span>
                      <span className="contacts-top-meta">
                        {FORM_STATUS_LABEL[f.status]}
                        {active && ' · Filtered'}
                      </span>
                    </span>
                    <span className="contacts-top-count">
                      {formatNumber(f.contacts)}
                      <span className="visually-hidden"> {f.contacts === 1 ? 'contact' : 'contacts'}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        )}
      </Card>
    </div>
  );
}
