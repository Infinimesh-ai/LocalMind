import { Content, P, Template, Title } from './components';

export default function TestMail() {
  return (
    <Template>
      <Title>Test Email from LocalMind</Title>
      <Content>
        <P>This is a test email from your LocalMind instance.</P>
      </Content>
    </Template>
  );
}
