// Types shared by the mail popup's server code and its browser component (no server imports here).

export type MailOption = { key: string; email: string; name: string; designation: string; section: string };
export type MailState = 'unsent' | 'running' | 'idle';

export type MailInfo = {
  invoiceNumber: string;
  uid: string;
  uidInDirectory: boolean;
  emailOptions: MailOption[];
  defaultTo: string[];          // option keys
  defaultCc: string[];
  savedManualValues: Record<string, string>;
  state: MailState;
  scheduled: boolean;           // first mail clicked outside the Region window
  cxoMail: boolean;             // Escalated to CXO / CXO mail pending / CXO mail scheduled
  cxoScheduled: boolean;
  savedHasCxo: boolean;         // saved To / Cc already has a CXO
  scheduledWindow: string;
  noOfFollowUps: number;
  nextMailReadable: string;
  followUpInterval: string;
  replyStatus: string;
  finalStatus: string;
  mailTemplate: string;
  followUpTemplate: string;
  paymentLinkIncluded: boolean;
  paymentLinkType: 'Standard' | 'Prorata';
  prorataPaymentLink: string;
  savedStdLink: string;
  region: string;
  autoFollowUpTemplate: string;
  mailTemplateCodes: { value: string; label: string }[];
  emptyAutoPlaceholders: string[];
};

/** Everything Save / Send / Start reads from the popup (pfCollectMailDraftParams). */
export type MailDraft = {
  invoiceNumber: string;
  to: MailOption[];
  cc: MailOption[];
  templateCode: string;          // the Mail template, or on a follow-up step the auto-picked follow-up template
  followUpTemplateCode: string;  // the auto-picked follow-up template, saved when "Also start follow-up" is on
  manualValues: Record<string, string>;
  alsoStartFollowUp: boolean;
  paymentLinkOn: boolean;
  paymentLinkType: 'Standard' | 'Prorata';
  typedLink: string;
  region: string;
  newCxo: boolean;              // first CXO ticked on a running / paused follow-up
};

export type PreviewResult = { html: string; attachments: { url: string; name: string }[] };
export type DocEntry = { fileType: string; url: string; uploadedBy: string; uploadedOn: string };
