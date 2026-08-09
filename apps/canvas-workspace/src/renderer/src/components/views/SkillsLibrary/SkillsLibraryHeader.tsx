import { Plus, UploadSimple } from '@phosphor-icons/react';
import { useI18n } from '../../../i18n';
import { Button } from '../../ui';

interface Props {
  onImport: () => void;
  onAdd: () => void;
}

export const SkillsLibraryHeader = ({ onImport, onAdd }: Props) => {
  const { t } = useI18n();

  return (
    <header className="skills-library__header">
      <div>
        <span>{t('skillsLibrary.kicker')}</span>
        <h1>{t('skillsLibrary.title')}</h1>
        <p>{t('skillsLibrary.description')}</p>
      </div>
      <div className="skills-library__header-actions">
        <Button variant="secondary" onClick={onImport}>
          <UploadSimple size={16} />
          {t('skillsLibrary.import')}
        </Button>
        <Button variant="primary" onClick={onAdd}>
          <Plus size={16} />
          {t('skillsConfig.add')}
        </Button>
      </div>
    </header>
  );
};
