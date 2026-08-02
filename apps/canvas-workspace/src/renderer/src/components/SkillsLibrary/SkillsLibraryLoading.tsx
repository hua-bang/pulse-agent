import { useI18n } from '../../i18n';

const LoadingBody = () => {
  const { t } = useI18n();

  return (
    <div
      className="skills-library__loading"
      role="status"
      aria-live="polite"
      aria-label={t('skillsLibrary.loading')}
    >
      <div className="skills-library__loading-scope" aria-hidden="true">
        <span className="skills-library__skeleton skills-library__skeleton--context" />
        <span className="skills-library__skeleton skills-library__skeleton--tabs" />
      </div>
      <span className="skills-library__skeleton skills-library__skeleton--search" aria-hidden="true" />
      <div className="skills-library__loading-heading">
        <strong>{t('skillsLibrary.loading')}</strong>
        <span className="skills-library__skeleton skills-library__skeleton--count" aria-hidden="true" />
      </div>
      <div className="skills-library__loading-list" aria-hidden="true">
        {[0, 1, 2, 3].map((row) => (
          <div key={row} className="skills-library__loading-row">
            <span className="skills-library__skeleton skills-library__skeleton--name" />
            <span className="skills-library__skeleton skills-library__skeleton--description" />
          </div>
        ))}
      </div>
    </div>
  );
};

export const SkillsLibraryLoading = () => <LoadingBody />;

export const SkillsRouteLoading = () => (
  <main className="skills-library skills-library--loading" aria-busy="true">
    <header className="skills-library__header skills-library__loading-header" aria-hidden="true">
      <div>
        <span className="skills-library__skeleton skills-library__skeleton--kicker" />
        <span className="skills-library__skeleton skills-library__skeleton--title" />
        <span className="skills-library__skeleton skills-library__skeleton--intro" />
      </div>
      <span className="skills-library__skeleton skills-library__skeleton--actions" />
    </header>
    <LoadingBody />
  </main>
);
