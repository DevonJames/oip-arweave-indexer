#!/usr/bin/env python3
"""
Offline Verification Framework
Comprehensive testing of the enhanced voice pipeline without internet connectivity
"""

import os
import sys
import json
import time
import socket
import subprocess
import tempfile
import logging
from typing import Dict, List, Any, Optional
from pathlib import Path
import requests
import numpy as np

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

class OfflineVerificationFramework:
    """Comprehensive offline verification system."""
    
    def __init__(self, config_path: Optional[str] = None):
        self.config = self._load_config(config_path)
        self.results = {
            'timestamp': time.time(),
            'tests': {},
            'summary': {
                'total_tests': 0,
                'passed': 0,
                'failed': 0,
                'warnings': 0
            }
        }
        
    def _load_config(self, config_path: Optional[str]) -> Dict[str, Any]:
        """Load verification configuration."""
        default_config = {
            'services': {
                'main_app': {'url': 'http://localhost:3000', 'required': True},
                'elasticsearch': {'url': 'http://localhost:9200', 'required': True},
                'ollama': {'url': 'http://localhost:11434', 'required': True},
                'kokoro_tts': {'url': 'http://localhost:8012', 'required': True},
                'stt_service': {'url': 'http://localhost:8010', 'required': False},
                'smart_turn': {'url': 'http://localhost:8011', 'required': False}
            },
            'models': {
                'required_paths': [
                    'models/kokoro/',
                    'models/silero_vad/',
                    'models/smart_turn/'
                ],
                'optional_paths': [
                    'models/whisper-mlx/',
                    'models/coqui/',
                    'models/piper/'
                ]
            },
            'network': {
                'isolation_test': True,
                'external_domains': [
                    'google.com',
                    'openai.com',
                    'huggingface.co',
                    'github.com'
                ]
            },
            'performance': {
                'stt_max_time_ms': 5000,
                'tts_max_time_ms': 3000,
                'rag_max_time_ms': 10000
            }
        }
        
        if config_path and os.path.exists(config_path):
            with open(config_path, 'r') as f:
                user_config = json.load(f)
                # Merge with default config
                default_config.update(user_config)
        
        return default_config
    
    def run_all_tests(self) -> Dict[str, Any]:
        """Run comprehensive offline verification tests."""
        logger.info("🧪 Starting Offline Verification Framework")
        logger.info("=" * 50)
        
        # Test categories
        test_categories = [
            ('Network Isolation', self.test_network_isolation),
            ('Service Availability', self.test_service_availability),
            ('Model Verification', self.test_model_availability),
            ('API Functionality', self.test_api_functionality),
            ('Pipeline Integration', self.test_pipeline_integration),
            ('Performance Benchmarks', self.test_performance),
            ('Error Handling', self.test_error_handling),
            ('Resource Usage', self.test_resource_usage)
        ]
        
        for category_name, test_func in test_categories:
            logger.info(f"\n📋 Testing: {category_name}")
            logger.info("-" * 30)
            
            try:
                test_result = test_func()
                self.results['tests'][category_name] = test_result
                
                if test_result['status'] == 'passed':
                    self.results['summary']['passed'] += 1
                    logger.info(f"✅ {category_name}: PASSED")
                elif test_result['status'] == 'warning':
                    self.results['summary']['warnings'] += 1
                    logger.warning(f"⚠️  {category_name}: WARNING")
                else:
                    self.results['summary']['failed'] += 1
                    logger.error(f"❌ {category_name}: FAILED")
                
                self.results['summary']['total_tests'] += 1
                
            except Exception as e:
                logger.error(f"❌ {category_name}: EXCEPTION - {str(e)}")
                self.results['tests'][category_name] = {
                    'status': 'failed',
                    'error': str(e),
                    'details': {}
                }
                self.results['summary']['failed'] += 1
                self.results['summary']['total_tests'] += 1
        
        # Generate final report
        self._generate_report()
        return self.results
    
    def test_network_isolation(self) -> Dict[str, Any]:
        """Test network isolation and external dependency detection."""
        result = {
            'status': 'passed',
            'details': {
                'external_connections': [],
                'blocked_domains': [],
                'network_accessible': True
            }
        }
        
        if not self.config['network']['isolation_test']:
            result['status'] = 'skipped'
            result['details']['reason'] = 'Network isolation test disabled'
            return result
        
        # Test external domain accessibility
        for domain in self.config['network']['external_domains']:
            try:
                socket.create_connection((domain, 80), timeout=3)
                result['details']['external_connections'].append(domain)
                logger.warning(f"⚠️  External connection possible: {domain}")
            except (socket.timeout, socket.gaierror, OSError):
                result['details']['blocked_domains'].append(domain)
                logger.info(f"✅ External connection blocked: {domain}")
        
        # Check if any external connections are possible
        if result['details']['external_connections']:
            result['status'] = 'warning'
            result['message'] = 'External network connections detected'
        else:
            result['message'] = 'Network properly isolated'
        
        return result
    
    def test_service_availability(self) -> Dict[str, Any]:
        """Test availability of all required services."""
        result = {
            'status': 'passed',
            'details': {
                'services': {},
                'required_failures': [],
                'optional_failures': []
            }
        }
        
        for service_name, service_config in self.config['services'].items():
            service_result = self._test_service_health(service_name, service_config)
            result['details']['services'][service_name] = service_result
            
            if not service_result['available']:
                if service_config['required']:
                    result['details']['required_failures'].append(service_name)
                    logger.error(f"❌ Required service unavailable: {service_name}")
                else:
                    result['details']['optional_failures'].append(service_name)
                    logger.warning(f"⚠️  Optional service unavailable: {service_name}")
            else:
                logger.info(f"✅ Service available: {service_name}")
        
        # Determine overall status
        if result['details']['required_failures']:
            result['status'] = 'failed'
            result['message'] = f"Required services unavailable: {result['details']['required_failures']}"
        elif result['details']['optional_failures']:
            result['status'] = 'warning'
            result['message'] = f"Optional services unavailable: {result['details']['optional_failures']}"
        else:
            result['message'] = 'All services available'
        
        return result
    
    def _test_service_health(self, service_name: str, service_config: Dict) -> Dict[str, Any]:
        """Test individual service health."""
        service_result = {
            'available': False,
            'response_time_ms': None,
            'status_code': None,
            'details': {}
        }
        
        try:
            start_time = time.time()
            response = requests.get(f"{service_config['url']}/health", timeout=5)
            response_time = (time.time() - start_time) * 1000
            
            service_result['available'] = response.status_code == 200
            service_result['response_time_ms'] = response_time
            service_result['status_code'] = response.status_code
            
            if response.status_code == 200:
                try:
                    service_result['details'] = response.json()
                except:
                    service_result['details'] = {'response': 'non-json'}
            
        except requests.exceptions.RequestException as e:
            service_result['error'] = str(e)
        
        return service_result
    
    def test_model_availability(self) -> Dict[str, Any]:
        """Test availability of AI models and files."""
        result = {
            'status': 'passed',
            'details': {
                'required_models': {},
                'optional_models': {},
                'missing_required': [],
                'missing_optional': []
            }
        }
        
        # Check required model paths
        for model_path in self.config['models']['required_paths']:
            path_obj = Path(model_path)
            is_available = path_obj.exists() and any(path_obj.iterdir()) if path_obj.is_dir() else path_obj.exists()
            
            result['details']['required_models'][model_path] = {
                'available': is_available,
                'path_exists': path_obj.exists(),
                'is_directory': path_obj.is_dir(),
                'file_count': len(list(path_obj.iterdir())) if path_obj.is_dir() and path_obj.exists() else 0
            }
            
            if not is_available:
                result['details']['missing_required'].append(model_path)
                logger.error(f"❌ Required model missing: {model_path}")
            else:
                logger.info(f"✅ Required model available: {model_path}")
        
        # Check optional model paths
        for model_path in self.config['models']['optional_paths']:
            path_obj = Path(model_path)
            is_available = path_obj.exists() and any(path_obj.iterdir()) if path_obj.is_dir() else path_obj.exists()
            
            result['details']['optional_models'][model_path] = {
                'available': is_available,
                'path_exists': path_obj.exists(),
                'is_directory': path_obj.is_dir(),
                'file_count': len(list(path_obj.iterdir())) if path_obj.is_dir() and path_obj.exists() else 0
            }
            
            if not is_available:
                result['details']['missing_optional'].append(model_path)
                logger.warning(f"⚠️  Optional model missing: {model_path}")
            else:
                logger.info(f"✅ Optional model available: {model_path}")
        
        # Determine status
        if result['details']['missing_required']:
            result['status'] = 'failed'
            result['message'] = f"Required models missing: {result['details']['missing_required']}"
        elif result['details']['missing_optional']:
            result['status'] = 'warning'
            result['message'] = f"Optional models missing: {result['details']['missing_optional']}"
        else:
            result['message'] = 'All models available'
        
        return result
    
    def test_api_functionality(self) -> Dict[str, Any]:
        """Test API endpoints functionality."""
        result = {
            'status': 'passed',
            'details': {
                'endpoints': {},
                'failed_endpoints': []
            }
        }
        
        # Define test endpoints
        test_endpoints = [
            ('Main App Health', 'GET', 'http://localhost:3000/api/voice/health'),
            ('TTS Health', 'GET', 'http://localhost:8012/health'),
            ('Elasticsearch Health', 'GET', 'http://localhost:9200/_cluster/health'),
            ('Ollama Models', 'GET', 'http://localhost:11434/api/tags')
        ]
        
        for endpoint_name, method, url in test_endpoints:
            endpoint_result = self._test_api_endpoint(endpoint_name, method, url)
            result['details']['endpoints'][endpoint_name] = endpoint_result
            
            if not endpoint_result['success']:
                result['details']['failed_endpoints'].append(endpoint_name)
                logger.error(f"❌ API endpoint failed: {endpoint_name}")
            else:
                logger.info(f"✅ API endpoint working: {endpoint_name}")
        
        if result['details']['failed_endpoints']:
            result['status'] = 'failed'
            result['message'] = f"API endpoints failed: {result['details']['failed_endpoints']}"
        else:
            result['message'] = 'All API endpoints working'
        
        return result
    
    def _test_api_endpoint(self, name: str, method: str, url: str) -> Dict[str, Any]:
        """Test individual API endpoint."""
        endpoint_result = {
            'success': False,
            'response_time_ms': None,
            'status_code': None,
            'response_size': None
        }
        
        try:
            start_time = time.time()
            
            if method.upper() == 'GET':
                response = requests.get(url, timeout=10)
            elif method.upper() == 'POST':
                response = requests.post(url, timeout=10)
            else:
                raise ValueError(f"Unsupported method: {method}")
            
            response_time = (time.time() - start_time) * 1000
            
            endpoint_result['success'] = response.status_code < 400
            endpoint_result['response_time_ms'] = response_time
            endpoint_result['status_code'] = response.status_code
            endpoint_result['response_size'] = len(response.content)
            
        except requests.exceptions.RequestException as e:
            endpoint_result['error'] = str(e)
        
        return endpoint_result
    
    def test_pipeline_integration(self) -> Dict[str, Any]:
        """Test end-to-end pipeline integration."""
        result = {
            'status': 'passed',
            'details': {
                'tts_test': {},
                'rag_test': {},
                'integration_successful': False
            }
        }
        
        try:
            # Test TTS functionality
            logger.info("Testing TTS synthesis...")
            tts_result = self._test_tts_synthesis("Hello, this is a test of the offline TTS system.")
            result['details']['tts_test'] = tts_result
            
            if not tts_result['success']:
                logger.error("❌ TTS test failed")
                result['status'] = 'failed'
            else:
                logger.info("✅ TTS test passed")
            
            # Test RAG functionality
            logger.info("Testing RAG query...")
            rag_result = self._test_rag_query("What is the Open Index Protocol?")
            result['details']['rag_test'] = rag_result
            
            if not rag_result['success']:
                logger.error("❌ RAG test failed")
                result['status'] = 'failed'
            else:
                logger.info("✅ RAG test passed")
            
            # Overall integration status
            result['details']['integration_successful'] = (
                tts_result['success'] and rag_result['success']
            )
            
            if result['details']['integration_successful']:
                result['message'] = 'Pipeline integration successful'
            else:
                result['status'] = 'failed'
                result['message'] = 'Pipeline integration failed'
                
        except Exception as e:
            result['status'] = 'failed'
            result['error'] = str(e)
            result['message'] = f'Pipeline integration error: {str(e)}'
        
        return result
    
    def _test_tts_synthesis(self, text: str) -> Dict[str, Any]:
        """Test TTS synthesis functionality."""
        tts_result = {
            'success': False,
            'response_time_ms': None,
            'audio_size': None,
            'engine_used': None
        }
        
        try:
            start_time = time.time()
            
            response = requests.post(
                'http://localhost:8012/synthesize',
                json={
                    'text': text,
                    'voice': 'default',
                    'engine': 'kokoro'
                },
                timeout=15
            )
            
            response_time = (time.time() - start_time) * 1000
            
            tts_result['success'] = response.status_code == 200
            tts_result['response_time_ms'] = response_time
            tts_result['status_code'] = response.status_code
            
            if response.status_code == 200:
                response_data = response.json()
                tts_result['audio_size'] = len(response_data.get('audio_data', ''))
                tts_result['engine_used'] = response.headers.get('x-engine-used', 'unknown')
            
        except requests.exceptions.RequestException as e:
            tts_result['error'] = str(e)
        
        return tts_result
    
    def _test_rag_query(self, query: str) -> Dict[str, Any]:
        """Test RAG query functionality."""
        rag_result = {
            'success': False,
            'response_time_ms': None,
            'response_length': None,
            'sources_found': 0
        }
        
        try:
            start_time = time.time()
            
            response = requests.post(
                'http://localhost:3000/api/alfred/query',
                json={'query': query},
                timeout=20
            )
            
            response_time = (time.time() - start_time) * 1000
            
            rag_result['success'] = response.status_code == 200
            rag_result['response_time_ms'] = response_time
            rag_result['status_code'] = response.status_code
            
            if response.status_code == 200:
                response_data = response.json()
                rag_result['response_length'] = len(response_data.get('response', ''))
                rag_result['sources_found'] = len(response_data.get('sources', []))
            
        except requests.exceptions.RequestException as e:
            rag_result['error'] = str(e)
        
        return rag_result
    
    def test_performance(self) -> Dict[str, Any]:
        """Test performance benchmarks."""
        result = {
            'status': 'passed',
            'details': {
                'performance_tests': {},
                'slow_operations': []
            }
        }
        
        # Define performance tests
        perf_tests = [
            ('TTS Synthesis', lambda: self._test_tts_synthesis("Performance test"), 
             self.config['performance']['tts_max_time_ms']),
            ('RAG Query', lambda: self._test_rag_query("Performance test query"),
             self.config['performance']['rag_max_time_ms'])
        ]
        
        for test_name, test_func, max_time_ms in perf_tests:
            logger.info(f"Testing performance: {test_name}")
            
            test_result = test_func()
            result['details']['performance_tests'][test_name] = test_result
            
            if test_result.get('response_time_ms', float('inf')) > max_time_ms:
                result['details']['slow_operations'].append({
                    'test': test_name,
                    'time_ms': test_result.get('response_time_ms'),
                    'max_time_ms': max_time_ms
                })
                logger.warning(f"⚠️  {test_name} slower than expected: {test_result.get('response_time_ms', 0):.1f}ms > {max_time_ms}ms")
            else:
                logger.info(f"✅ {test_name} performance acceptable: {test_result.get('response_time_ms', 0):.1f}ms")
        
        if result['details']['slow_operations']:
            result['status'] = 'warning'
            result['message'] = f"Performance issues detected: {len(result['details']['slow_operations'])} slow operations"
        else:
            result['message'] = 'All performance tests passed'
        
        return result
    
    def test_error_handling(self) -> Dict[str, Any]:
        """Test error handling capabilities."""
        result = {
            'status': 'passed',
            'details': {
                'error_tests': {},
                'unexpected_errors': []
            }
        }
        
        # Define error tests
        error_tests = [
            ('Invalid TTS Request', lambda: self._test_invalid_tts_request()),
            ('Invalid RAG Query', lambda: self._test_invalid_rag_query()),
            ('Malformed JSON', lambda: self._test_malformed_json())
        ]
        
        for test_name, test_func in error_tests:
            logger.info(f"Testing error handling: {test_name}")
            
            try:
                test_result = test_func()
                result['details']['error_tests'][test_name] = test_result
                
                if test_result.get('handled_correctly', False):
                    logger.info(f"✅ {test_name}: Error handled correctly")
                else:
                    logger.warning(f"⚠️  {test_name}: Error handling suboptimal")
                    result['status'] = 'warning'
                    
            except Exception as e:
                logger.error(f"❌ {test_name}: Unexpected error - {str(e)}")
                result['details']['unexpected_errors'].append({
                    'test': test_name,
                    'error': str(e)
                })
                result['status'] = 'failed'
        
        if result['details']['unexpected_errors']:
            result['message'] = f"Unexpected errors in error handling tests: {len(result['details']['unexpected_errors'])}"
        elif result['status'] == 'warning':
            result['message'] = 'Some error handling could be improved'
        else:
            result['message'] = 'Error handling working correctly'
        
        return result
    
    def _test_invalid_tts_request(self) -> Dict[str, Any]:
        """Test TTS with invalid request."""
        try:
            response = requests.post(
                'http://localhost:8012/synthesize',
                json={'invalid': 'request'},
                timeout=5
            )
            
            return {
                'handled_correctly': 400 <= response.status_code < 500,
                'status_code': response.status_code,
                'response_time_ms': 0  # Not measuring for error tests
            }
        except:
            return {'handled_correctly': False, 'error': 'Request failed'}
    
    def _test_invalid_rag_query(self) -> Dict[str, Any]:
        """Test RAG with invalid query."""
        try:
            response = requests.post(
                'http://localhost:3000/api/alfred/query',
                json={'invalid': 'query'},
                timeout=5
            )
            
            return {
                'handled_correctly': 400 <= response.status_code < 500,
                'status_code': response.status_code,
                'response_time_ms': 0
            }
        except:
            return {'handled_correctly': False, 'error': 'Request failed'}
    
    def _test_malformed_json(self) -> Dict[str, Any]:
        """Test malformed JSON handling."""
        try:
            response = requests.post(
                'http://localhost:8012/synthesize',
                data='{"invalid": json}',
                headers={'Content-Type': 'application/json'},
                timeout=5
            )
            
            return {
                'handled_correctly': 400 <= response.status_code < 500,
                'status_code': response.status_code,
                'response_time_ms': 0
            }
        except:
            return {'handled_correctly': False, 'error': 'Request failed'}
    
    def test_resource_usage(self) -> Dict[str, Any]:
        """Test system resource usage."""
        result = {
            'status': 'passed',
            'details': {
                'docker_stats': {},
                'system_resources': {},
                'resource_warnings': []
            }
        }
        
        try:
            # Get Docker container stats
            docker_stats = self._get_docker_stats()
            result['details']['docker_stats'] = docker_stats
            
            # Check for resource warnings
            for container, stats in docker_stats.items():
                if stats.get('memory_usage_mb', 0) > 2000:  # > 2GB
                    result['details']['resource_warnings'].append({
                        'container': container,
                        'issue': 'high_memory',
                        'value': stats.get('memory_usage_mb')
                    })
                
                if stats.get('cpu_usage_percent', 0) > 80:  # > 80% CPU
                    result['details']['resource_warnings'].append({
                        'container': container,
                        'issue': 'high_cpu',
                        'value': stats.get('cpu_usage_percent')
                    })
            
            if result['details']['resource_warnings']:
                result['status'] = 'warning'
                result['message'] = f"Resource usage warnings: {len(result['details']['resource_warnings'])}"
                logger.warning(f"⚠️  Resource usage warnings detected")
            else:
                result['message'] = 'Resource usage within normal limits'
                logger.info("✅ Resource usage normal")
                
        except Exception as e:
            result['status'] = 'warning'
            result['error'] = str(e)
            result['message'] = f'Could not check resource usage: {str(e)}'
            logger.warning(f"⚠️  Resource usage check failed: {str(e)}")
        
        return result
    
    def _get_docker_stats(self) -> Dict[str, Any]:
        """Get Docker container statistics."""
        stats = {}
        
        try:
            # Get container stats
            result = subprocess.run(
                ['docker', 'stats', '--no-stream', '--format', 'table {{.Container}}\t{{.CPUPerc}}\t{{.MemUsage}}'],
                capture_output=True,
                text=True,
                timeout=10
            )
            
            if result.returncode == 0:
                lines = result.stdout.strip().split('\n')[1:]  # Skip header
                
                for line in lines:
                    parts = line.split('\t')
                    if len(parts) >= 3:
                        container = parts[0]
                        cpu_percent = parts[1].replace('%', '')
                        mem_usage = parts[2]
                        
                        # Parse memory usage (e.g., "123.4MiB / 2GiB")
                        mem_parts = mem_usage.split(' / ')
                        if len(mem_parts) == 2:
                            used_mem = mem_parts[0]
                            # Convert to MB
                            if 'MiB' in used_mem:
                                mem_mb = float(used_mem.replace('MiB', ''))
                            elif 'GiB' in used_mem:
                                mem_mb = float(used_mem.replace('GiB', '')) * 1024
                            else:
                                mem_mb = 0
                            
                            stats[container] = {
                                'cpu_usage_percent': float(cpu_percent) if cpu_percent.replace('.', '').isdigit() else 0,
                                'memory_usage_mb': mem_mb
                            }
                        
        except Exception as e:
            logger.warning(f"Could not get Docker stats: {e}")
        
        return stats
    
    def _generate_report(self):
        """Generate comprehensive verification report."""
        logger.info("\n" + "=" * 60)
        logger.info("🧪 OFFLINE VERIFICATION REPORT")
        logger.info("=" * 60)
        
        # Summary
        summary = self.results['summary']
        total = summary['total_tests']
        passed = summary['passed']
        failed = summary['failed']
        warnings = summary['warnings']
        
        logger.info(f"📊 Test Summary:")
        logger.info(f"   Total Tests: {total}")
        logger.info(f"   ✅ Passed: {passed}")
        logger.info(f"   ❌ Failed: {failed}")
        logger.info(f"   ⚠️  Warnings: {warnings}")
        
        if failed == 0 and warnings == 0:
            logger.info("\n🎉 ALL TESTS PASSED - System ready for offline operation!")
        elif failed == 0:
            logger.info(f"\n⚠️  TESTS PASSED WITH WARNINGS - System functional but {warnings} issues detected")
        else:
            logger.error(f"\n❌ TESTS FAILED - {failed} critical issues must be resolved")
        
        # Save detailed report
        report_path = 'logs/offline_verification_report.json'
        os.makedirs(os.path.dirname(report_path), exist_ok=True)
        
        with open(report_path, 'w') as f:
            json.dump(self.results, f, indent=2, default=str)
        
        logger.info(f"\n📄 Detailed report saved to: {report_path}")

def main():
    """Main function for command-line execution."""
    import argparse
    
    parser = argparse.ArgumentParser(description='Offline Verification Framework')
    parser.add_argument('--config', help='Configuration file path')
    parser.add_argument('--output', help='Output report path')
    args = parser.parse_args()
    
    # Run verification
    framework = OfflineVerificationFramework(args.config)
    results = framework.run_all_tests()
    
    # Save results if output specified
    if args.output:
        with open(args.output, 'w') as f:
            json.dump(results, f, indent=2, default=str)
        print(f"Results saved to: {args.output}")
    
    # Exit with appropriate code
    if results['summary']['failed'] > 0:
        sys.exit(1)
    elif results['summary']['warnings'] > 0:
        sys.exit(2)
    else:
        sys.exit(0)

if __name__ == "__main__":
    main()
