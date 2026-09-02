import {
  adminAiProfilesQuery,
  setAdminUserAiProfileAssignmentMutation,
} from '@affine/graphql';

import { app, e2e, Mockers } from '../test';

type GraphQLErrorResponse = {
  errors?: Array<{ extensions?: { name?: string } }>;
};

e2e('AI Profile admin GraphQL rejects ordinary users', async t => {
  const user = await app.create(Mockers.User);
  await app.login(user);

  const queryResponse = await app
    .POST('/graphql')
    .send({
      operationName: adminAiProfilesQuery.op,
      query: adminAiProfilesQuery.query,
      variables: { workspaceId: null },
    })
    .expect(200);
  const queryBody = queryResponse.body as GraphQLErrorResponse;
  t.is(queryBody.errors?.[0]?.extensions?.name, 'ACTION_FORBIDDEN');

  const mutationResponse = await app
    .POST('/graphql')
    .send({
      operationName: setAdminUserAiProfileAssignmentMutation.op,
      query: setAdminUserAiProfileAssignmentMutation.query,
      variables: { userId: user.id, profileId: null },
    })
    .expect(200);
  const mutationBody = mutationResponse.body as GraphQLErrorResponse;
  t.is(mutationBody.errors?.[0]?.extensions?.name, 'ACTION_FORBIDDEN');
});
