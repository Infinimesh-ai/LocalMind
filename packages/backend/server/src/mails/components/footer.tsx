import { Container } from '@react-email/container';
import { Link } from '@react-email/link';
import { Row } from '@react-email/row';
import { Section } from '@react-email/section';
import type { CSSProperties } from 'react';

import { BasicTextStyle, LOCALMIND_WEBSITE_URL } from './common';

const TextStyles: CSSProperties = {
  ...BasicTextStyle,
  color: '#8e8d91',
  marginTop: '8px',
};

export const Footer = () => {
  return (
    <Container
      style={{
        backgroundColor: '#fafafa',
        maxWidth: '450px',
        marginTop: '0',
        marginBottom: '32px',
        borderRadius: '0 0 16px 16px',
        boxShadow: '0px 0px 20px 0px rgba(66, 65, 73, 0.04)',
        padding: '24px',
      }}
    >
      <Section align="center" width="auto" style={{ margin: '1px auto' }}>
        <Row>
          <td>
            <Link
              href={LOCALMIND_WEBSITE_URL}
              style={{
                ...TextStyles,
                color: '#C8322A',
                fontWeight: '600',
                textDecoration: 'none',
              }}
            >
              LocalMind on GitHub
            </Link>
          </td>
        </Row>
      </Section>
      <Section align="center" width="auto">
        <Row style={TextStyles}>
          <td>A local-first workspace for auditable AI workflows</td>
        </Row>
      </Section>
      <Section align="center" width="auto">
        <Row style={TextStyles}>
          <td>
            Copyright {new Date().getUTCFullYear()} LocalMind contributors
          </td>
        </Row>
      </Section>
    </Container>
  );
};
