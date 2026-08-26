import { link } from './blocks.css';

export const BlogLink = () => {
  return (
    <a className={link} href={`${BUILD_CONFIG.githubUrl}/tree/main/docs`}>
      Check other articles
    </a>
  );
};
