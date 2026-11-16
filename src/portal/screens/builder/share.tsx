import {
  EmbedSection,
  FrontPageSection,
  LinkSection,
  PopupSection,
  QrSection,
  SeoSection,
} from '../../intelform/builder/share/ShareSections';
import {PageHeader} from '../../ui';

/**
 * `/forms/$formId/share`: the form's link and custom slug, search and social preview, inline
 * and popup embed codes, a QR code, and the homepage listing. Rendered inside BuilderLayout,
 * which provides the builder store.
 */
export function ShareTab() {
  return (
    <div className="app-page screen-share">
      <PageHeader title="Share" description="The form's link, embed code and QR code." />
      <div className="if-share-stack">
        <LinkSection />
        <SeoSection />
        <EmbedSection />
        <PopupSection />
        <QrSection />
        <FrontPageSection />
      </div>
    </div>
  );
}
