import { useI18n } from '../../../i18n';

const Skeleton = ({ width, height, grow = false }: { width: string; height: string; grow?: boolean }) => (
  <span className="skills-library__skeleton" style={{ width, height, flex: grow ? 1 : undefined }} />
);

const LoadingBody = () => {
  const { t } = useI18n();

  return (
    <div
      className="skills-library__loading"
      role="status"
      aria-live="polite"
      aria-label={t('skillsLibrary.loading')}
    >
      <div className="skills-library__scope-bar" aria-hidden="true">
        <Skeleton width="280px" height="34px" />
        <Skeleton width="auto" height="34px" grow />
      </div>
      <div className="skills-library__search" aria-hidden="true">
        <Skeleton width="100%" height="38px" />
      </div>
      <div className="skills-library__list-heading">
        <strong>{t('skillsLibrary.loading')}</strong>
        <span aria-hidden="true"><Skeleton width="48px" height="10px" /></span>
      </div>
      <div className="skills-library__list" aria-hidden="true">
        {[0, 1, 2, 3].map((row) => (
          <div key={row} className="skills-library__loading-row">
            <Skeleton width="min(180px, 40%)" height="13px" />
            <Skeleton width="min(720px, 72%)" height="10px" />
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
        <Skeleton width="62px" height="9px" />
        <Skeleton width="118px" height="25px" />
        <Skeleton width="min(520px, 48vw)" height="11px" />
      </div>
      <Skeleton width="226px" height="34px" />
    </header>
    <LoadingBody />
  </main>
);
