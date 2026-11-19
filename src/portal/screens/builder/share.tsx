import {
  EmbedSection,
  FrontPageSection,
  LinkSection,
  PopupSection,
  QrSection,
  SeoSection,
} from '../../intelform/builder/share/ShareSections';

/**
 * `/forms/$formId/share`: the form's link and custom slug, search and social preview, inline
 * and popup embed codes, a QR code, and the homepage listing. Rendered inside BuilderLayout,
 * which provides the builder store.
 */
export function ShareTab() {
  return (
    <div className="app-page screen-share">
      <h2 className="visually-hidden">Share</h2>
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
