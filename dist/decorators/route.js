// src/decorators/route.ts
import 'reflect-metadata';
export const Route = (meta) => {
    return (target, propertyKey) => {
        const constructor = target.constructor;
        const routes = Reflect.getMetadata('routes', constructor) || [];
        routes.push({ handler: propertyKey, ...meta });
        Reflect.defineMetadata('routes', routes, constructor);
    };
};
