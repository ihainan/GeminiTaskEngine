# Gemini Development Guidelines for Software Scalpel Backend Service

This file contains specific guidelines for Gemini Code when working on the Software Scalpel Backend Service project.

## Code Standards

### Language and Style
- **All code and comments must be written in English only**
- **No emojis in code** - Keep code professional and clean (unless pre-existing code already uses emojis)
- Follow TypeScript strict mode standards
- Use consistent naming conventions (camelCase for variables/functions, PascalCase for classes/types)

### Development Workflow

#### Before Making Changes
1. **Always read and follow @AI_CODING_GUIDE.md** before adding or modifying any code
2. **Read GIT_GUIDELINES.md** when performing git operations in this directory
3. Review existing code patterns and follow established conventions
4. Check TODO.md for current project status and priorities

#### Code Quality Requirements
- Use TypeScript strict mode with proper type definitions
- Follow the existing project structure and patterns
- Add JSDoc comments for public APIs and complex functions
- Implement proper error handling using the established error system
- Include input validation for all public methods

### Project-Specific Guidelines

#### Database Operations
- Always use transactions for multi-step database operations
- Use the established migration system for schema changes
- Follow the naming conventions in existing migrations
- Test database operations with `npm run db:migrate` commands

#### Configuration Management
- Use the centralized config system in `src/config/`
- Validate all configuration using Joi schemas
- Support environment-specific overrides
- Document new environment variables in `.env.example`

#### Error Handling
- Use the custom error classes in `src/types/errors.ts`
- Provide meaningful error messages and error codes
- Include correlation IDs for tracking
- Follow the established error severity levels

#### Testing and Validation
- Run `npm run build` to ensure TypeScript compilation
- Execute `npm test` if tests exist
- Use `npm run lint` to check code style
- Test database migrations in development environment

#### API Design
- Follow RESTful conventions
- Use established response formats in `src/types/api.ts`
- Implement proper status codes
- Include comprehensive request/response validation

### Git Workflow

#### Commit Messages
Follow Conventional Commits specification:
```
<type>[optional scope]: <description>

[optional body]

[optional footer(s)]
```

Common types for this project:
- `feat`: New features
- `fix`: Bug fixes
- `refactor`: Code improvements
- `docs`: Documentation updates
- `test`: Test additions
- `db`: Database schema changes
- `config`: Configuration changes

#### Pre-commit Checklist
- [ ] TypeScript compiles without errors
- [ ] Database migrations run successfully
- [ ] Code follows established patterns
- [ ] Error handling is implemented
- [ ] Documentation is updated if needed

### Architecture Adherence

#### Layered Architecture
Follow the established layers:
```
Controllers → Services → Models → Database
Types → Config → Utils
Workers → Queue System
```

#### Dependency Management
- Use dependency injection patterns
- Avoid circular dependencies
- Import from established barrel exports
- Follow the module structure in `src/`

### Performance Considerations
- Use connection pooling for database operations
- Implement proper caching strategies
- Follow async/await patterns consistently
- Monitor resource usage in container environments

### Security Guidelines
- Never expose sensitive configuration
- Use proper input validation
- Implement rate limiting where appropriate
- Follow secure coding practices for file operations

### Documentation Requirements
- Update TODO.md when completing tasks
- Maintain DESIGN.md alignment
- Document API changes in appropriate files
- Include migration notes for database changes

## Development Environment

### Required Tools
- Node.js 18+
- TypeScript 5.3+
- PostgreSQL (via Docker)
- Redis (via Docker)
- Docker and Docker Compose

### Development Commands
```bash
# Database operations
npm run db:migrate up      # Run migrations
npm run db:migrate status  # Check migration status
npm run db:migrate health  # Database health check

# Development
npm run dev               # Start development server
npm run build            # Compile TypeScript
npm run lint             # Check code style
npm run test             # Run tests

# Docker environment
npm run docker:dev       # Start development infrastructure
```

### Environment Setup
1. Copy `.env.example` to `.env`
2. Start Docker services: `npm run docker:dev`
3. Run migrations: `npm run db:migrate up`
4. Verify setup: `npm run db:migrate health`

## Common Tasks

### Adding New Features
1. Update types in `src/types/` if needed
2. Create/update models in `src/models/`
3. Implement services in `src/services/`
4. Add controllers in `src/controllers/`
5. Update routes and middleware
6. Test thoroughly with database

### Database Schema Changes
1. Create new migration file in `migrations/`
2. Follow naming convention: `00X_description.sql`
3. Include proper indexes and constraints
4. Test migration up and down
5. Update corresponding TypeScript types

### Error Handling Implementation
1. Use appropriate error class from `src/types/errors.ts`
2. Include meaningful error codes and messages
3. Add correlation IDs for tracking
4. Implement proper HTTP status codes
5. Log errors appropriately

Remember: This is a production-quality backend service. All code should meet enterprise standards for reliability, maintainability, and security.
