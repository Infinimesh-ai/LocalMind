import { Content, P, Template, Title } from './components';
export default function ProjectReportReady(props: {
  deliveryId: string;
  title: string;
  url: string;
}) {
  return (
    <Template>
      <Title>{props.title}</Title>
      <Content>
        <P>
          A finalized project report is ready. This link opens only the
          authorized report version.
        </P>
        <P>
          <a href={props.url}>Open report</a>
        </P>
      </Content>
    </Template>
  );
}
