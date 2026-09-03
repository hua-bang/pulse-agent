import arcadeIcon from './assets/arcade.png';
import exaIcon from './assets/exa.png';
import mobbinIcon from './assets/mobbin.png';
import opnformIcon from './assets/opnform.png';
import resendIcon from './assets/resend.jpg';
import transcriptApiIcon from './assets/transcriptapi.png';

export const PLUGIN_BRAND_IMAGES: Readonly<Record<string, string>> = {
  arcade: arcadeIcon,
  exa: exaIcon,
  mobbin: mobbinIcon,
  opnform: opnformIcon,
  resend: resendIcon,
  transcriptapi: transcriptApiIcon,
};

export const normalizePluginIconKey = (value: string | undefined): string => (
  value?.trim().toLowerCase().replace(/[ _]+/g, '-') ?? ''
);
