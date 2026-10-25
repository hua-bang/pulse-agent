import { Plus, UploadSimple } from '@phosphor-icons/react';
import { useI18n } from '../../../i18n';
import { Button, PageHeader } from '../../../components/ui';

interface Props {
  onImport: () => void;
  onAdd: () => void;
}

export const SkillsLibraryHeader = ({ onImport, onAdd }: Props) => {
  const { t } = useI18n();

  return (
    <PageHeader
      className="skills-library__header"
      kicker={t('skillsLibrary.kicker')}
      title={t('skillsLibrary.title')}
      description={t('skillsLibrary.description')}
      actions={(
        <>
          <Button variant="secondary" onClick={onImport}>
            <UploadSimple size={16} />
            {t('skillsLibrary.import')}
          </Button>
          <Button variant="primary" onClick={onAdd}>
            <Plus size={16} />
            {t('skillsConfig.add')}
          </Button>
        </>
      )}
    />
  );
};
