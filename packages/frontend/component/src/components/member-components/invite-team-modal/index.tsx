import { emailRegex } from '@affine/component/auth-components';
import type {
  InviteLink,
  WorkspaceInviteLinkExpireTime,
} from '@affine/graphql';
import { useI18n } from '@affine/i18n';
import { useCallback, useEffect, useState } from 'react';

import { ConfirmModal } from '../../../ui/modal';
import { type InviteMethodType, ModalContent } from './modal-content';
import * as styles from './styles.css';

export interface InviteTeamMemberModalProps {
  open: boolean;
  setOpen: (value: boolean) => void;
  onConfirm: (params: { emails: string[] }) => void;
  isMutating: boolean;
  inviteEmails: string;
  setInviteEmails: (value: string) => void;
  errors?: string[];
  copyTextToClipboard: (text: string) => Promise<boolean>;
  onGenerateInviteLink: (
    expireTime: WorkspaceInviteLinkExpireTime
  ) => Promise<string>;
  onRevokeInviteLink: () => Promise<boolean>;
  importCSV: React.ReactNode;
  invitationLink: InviteLink | null;
}

const parseEmailString = (emailString: string): string[] => {
  return emailString
    .split(',')
    .map(email => email.trim())
    .filter(email => email.length > 0);
};

export const InviteTeamMemberModal = ({
  open,
  setOpen,
  onConfirm,
  isMutating,
  inviteEmails,
  setInviteEmails,
  errors,
  copyTextToClipboard,
  onGenerateInviteLink,
  onRevokeInviteLink,
  importCSV,
  invitationLink,
}: InviteTeamMemberModalProps) => {
  const t = useI18n();
  const [isValidEmail, setIsValidEmail] = useState(true);
  const [inviteMethod, setInviteMethod] = useState<InviteMethodType>('email');

  const handleConfirm = useCallback(() => {
    if (isMutating) return;
    if (inviteMethod === 'link') {
      setOpen(false);
      return;
    }
    const inviteEmailsArray = parseEmailString(inviteEmails);
    const invalidEmail = inviteEmailsArray.find(
      email => !emailRegex.test(email)
    );
    if (inviteEmailsArray.length === 0 || invalidEmail) {
      setIsValidEmail(false);
      return;
    }
    setIsValidEmail(true);

    onConfirm({
      emails: inviteEmailsArray,
    });
  }, [inviteEmails, inviteMethod, isMutating, onConfirm, setOpen]);

  useEffect(() => {
    setIsValidEmail(true);
  }, [inviteEmails]);

  useEffect(() => {
    if (!open) {
      setInviteEmails('');
      setIsValidEmail(true);
    }
  }, [open, setInviteEmails]);

  return (
    <ConfirmModal
      width={480}
      open={open}
      onOpenChange={setOpen}
      title={t['com.affine.payment.member.team.invite.title']()}
      cancelText={t['com.affine.inviteModal.button.cancel']()}
      cancelButtonOptions={{
        variant: 'secondary',
      }}
      contentOptions={{
        ['data-testid' as string]: 'invite-modal',
        style: {
          padding: '20px 24px',
        },
      }}
      confirmText={
        inviteMethod === 'email'
          ? t['com.affine.payment.member.team.invite.send-invites']()
          : t['com.affine.payment.member.team.invite.done']()
      }
      confirmButtonOptions={{
        loading: isMutating,
        variant: 'primary',
      }}
      onConfirm={handleConfirm}
      childrenContentClassName={styles.contentStyle}
    >
      <ModalContent
        invitationLink={invitationLink}
        inviteEmail={inviteEmails}
        setInviteEmail={setInviteEmails}
        handleConfirm={handleConfirm}
        isMutating={isMutating}
        isValidEmail={isValidEmail}
        inviteMethod={inviteMethod}
        importCSV={importCSV}
        onInviteMethodChange={setInviteMethod}
        copyTextToClipboard={copyTextToClipboard}
        onGenerateInviteLink={onGenerateInviteLink}
        onRevokeInviteLink={onRevokeInviteLink}
      />
      {errors?.length ? (
        <div className={styles.errorHint} role="alert">
          {errors.map(message => (
            <div key={message}>{message}</div>
          ))}
        </div>
      ) : null}
    </ConfirmModal>
  );
};
