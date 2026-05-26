from setuptools import setup, find_packages

setup(
    name="hsi-gonka",
    version="0.1.0",
    description="Decentralized AI layer for Homo Sapience Internet via Gonka Network",
    author="HSI Foundation",
    url="https://github.com/human-protocol/hsi-gonka",
    packages=find_packages(exclude=["tests*"]),
    python_requires=">=3.11",
    install_requires=[
        "openai>=1.40.0",
        "fastapi>=0.111.0",
        "uvicorn[standard]>=0.30.0",
        "pydantic>=2.7.0",
        "pydantic-settings>=2.3.0",
        "aiohttp>=3.9.0",
        "redis[asyncio]>=5.0.0",
        "python-dotenv>=1.0.0",
        "PyNaCl>=1.5.0",
        "structlog>=24.1.0",
        "tenacity>=8.3.0",
    ],
    extras_require={
        "dev": ["pytest>=8.2.0", "pytest-asyncio>=0.23.0"],
    },
    classifiers=[
        "Development Status :: 3 - Alpha",
        "License :: OSI Approved :: MIT License",
        "Programming Language :: Python :: 3.11",
        "Programming Language :: Python :: 3.12",
    ],
)
