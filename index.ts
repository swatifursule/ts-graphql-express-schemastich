// Server code
// import * as express from 'express';
// import * as bodyParser from 'body-parser';
// import {makeRemoteExecutableSchema, mergeSchemas, introspectSchema} from 'graphql-tools';
const express = require('express');
const bodyParser = require('body-parser');
const {addMockFunctionsToSchema, makeExecutableSchema, makeRemoteExecutableSchema, mergeSchemas, introspectSchema} = require('graphql-tools');

const {createApolloFetch} = require('apollo-fetch');

const {graphqlExpress, graphiqlExpress} = require('apollo-server-express');


process.on('unhandledRejection', (reason, promise) => {
    console.log('Unhandled Rejection at:', reason.stack || reason)
    // Recommended: send the information to sentry.io
    // or whatever crash reporting service you use
})
async function run() {
    console.log("Will start server here");

    // Mocked chirp schema
    // We don't worry about the schema implementation right now since we're just
    // demonstrating schema stitching.
    const chirpSchema = makeExecutableSchema({
        typeDefs: `
    type Chirp {
      id: ID!
      text: String
      authorId: ID!
    }
    
    type Query {
      chirpById(id: ID!): Chirp
      chirpsByAuthorId(authorId: ID!): [Chirp]
    }
    `
    });

    addMockFunctionsToSchema({ schema: chirpSchema });

    // Mocked author schema
    const authorSchema = makeExecutableSchema({
        typeDefs: `
    type User {
      id: ID!
      email: String
    }
    
    type Query {
      userById(id: ID!): User
    }
    `
    });

    addMockFunctionsToSchema({ schema: authorSchema });

    /* Generally, to create a remote schema, you need three steps:

    1. Create a link that can retrieve results from that schema or a fetcher (like apollo-fetch or node-fetch) instead of a link
    2. Use introspectSchema to get the schema of the remote server
    3. Use makeRemoteExecutableSchema to create a schema that uses the link to delegate requests to the underlying service
    */
    const createRemoteSchema = async(uri) => {
        const fetcher = createApolloFetch({uri});
        /* fetcher.use(({ request, options }, next) => {
            if (!options.headers) {
                options.headers = {};
            }
            options.headers['Authorization'] = `Bearer ${request.context.authKey}`;

            next();
        }); */
        return makeRemoteExecutableSchema({
            schema: await introspectSchema(fetcher),
            fetcher
        });
    };


    const universeSchema = await createRemoteSchema('https://www.universe.com/graphql/beta');
    const weatherSchema = await createRemoteSchema('https://5rrx10z19.lp.gql.zone/graphql');

    /*		*/
    /* To add ability to navigate between types, we need to extend existing types with new fields that translate between the types*/
    const linkSchemaDefs = `
        extend type Location {
            weather: Weather
        }

        extend type Event {
            location: Location
        }
        
        extend type User {
            chirps: [Chirp]
        }
        
        extend type Chirp {
            author: User
        }
        `;
    /* use mergeSchemas to combine multiple GraphQL schemas together and produce a merged schema that knows how to delegate parts of the query
    to the relevant subschemas. These subschemas can be either local to the server, or running on a remote server.
     */
    const schema = mergeSchemas({
        resolvers: {
            Event: {
                location: {
                    /* To delegate to root field and To avoid forcing users to add these fields to their queries manually,
                     resolvers on a merged schema can define a fragment property that specifies the required fields, and
                     they will be added to the query automatically.
                     */
                    fragment: `fragment EventFragment on Event {cityName}`,
                    // resolve(parent: any, args: any, context: any, info: any) {
                    resolve(parent, args, context, info) {
                        // const place: string = parent.cityName;
                        const place = parent.cityName;
                        return info.mergeInfo.delegateToSchema(
                            'query',
                            'location',
                            {place},
                            context,
                            info
                        )
                    }
                }
            },
            User: {
                chirps: {
                    fragment: `... on User { id }`,
                    resolve(user, args, context, info) {
                        return info.mergeInfo.delegateToSchema({
                            schema: chirpSchema,
                            operation: 'query',
                            fieldName: 'chirpsByAuthorId',
                            args: {
                                authorId: user.id,
                            },
                            context,
                            info,
                        });
                    },
                },
            },
            Chirp: {
                author: {
                    fragment: `... on Chirp { authorId }`,
                    resolve(chirp, args, context, info) {
                        return info.mergeInfo.delegateToSchema({
                            schema: authorSchema,
                            operation: 'query',
                            fieldName: 'userById',
                            args: {
                                id: chirp.authorId,
                            },
                            context,
                            info,
                        });
                    },
                },
            },
        },
    });
    /* server code */
    const app = express();
    app.use('/graphql', bodyParser.json(), graphqlExpress({schema}));

    app.use(
        '/graphiql',
        graphiqlExpress({
            endpointURL: '/graphql',
        })
    );

    app.listen(2000, () => {
        console.log("test listening");
    })
}



try {
    run();
} catch (e) {
    console.log(e, e.message, e.stack);
}